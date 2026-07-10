import { NextResponse } from "next/server";
import { estimateAIUsageCost } from "@debate/ai";
import { buildPracticeOpponentCopyPrompt, generatePracticeOpponentReply, summarizePracticeTranscript } from "@debate/ai/practice";
import { getPracticeRoundState, isPracticeMode, type PracticeMode } from "@debate/shared";
import { db } from "@debate/db";
import { requireUser } from "@/lib/auth";
import { resolveAIProvider } from "@/lib/ai-config";
import { checkRateLimit, jsonError, limitString, readLimitedJson, routeErrorResponse } from "@/lib/api-route-utils";
import { getPracticeSession, readPracticeSummary, readRubricFocus, readTranscript } from "@/lib/data";

const MAX_BODY_BYTES = 32_000;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_TRANSCRIPT_TURNS = 24;
// Once the transcript grows past this many entries, compress everything older
// than the most recent KEEP_RECENT_ENTRIES into a rolling summary so the AI can
// still "see" earlier context without blowing up the prompt.
const SUMMARY_TRIGGER_ENTRIES = 16;
const KEEP_RECENT_ENTRIES = 8;
const practiceLocks = new Map<string, Promise<void>>();

async function withPracticeLock<T>(sessionId: string, action: () => Promise<T>) {
  const previous = practiceLocks.get(sessionId) ?? Promise.resolve();
  let releaseLock!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const next = previous.then(() => current);
  practiceLocks.set(sessionId, next);

  await previous;
  try {
    return await action();
  } finally {
    releaseLock();
    if (practiceLocks.get(sessionId) === next) {
      practiceLocks.delete(sessionId);
    }
  }
}

export async function POST(request: Request) {
  const session = await requireUser();

  try {
    if (!checkRateLimit(`${session.user.id}:practice-reply`, 10, 60_000)) {
      return jsonError("Practice AI requests are rate limited. Please try again shortly.", 429);
    }

    const { body, response } = await readLimitedJson<{ sessionId?: string; message?: string; copyPromptOnly?: boolean }>(request, MAX_BODY_BYTES);
    if (response) {
      return response;
    }
    if (!body) {
      return jsonError("Request body is required.", 400);
    }

    const sessionId = String(body?.sessionId ?? "").trim();
    const message = limitString(body?.message, MAX_MESSAGE_LENGTH);

    if (!sessionId || !message) {
      return jsonError("Practice session and message are required.", 400);
    }

    if (typeof body?.message === "string" && body.message.trim().length > MAX_MESSAGE_LENGTH) {
      return jsonError(`Practice message 最多 ${MAX_MESSAGE_LENGTH} 个字符。`, 400);
    }

    const result = await withPracticeLock(sessionId, async () => {
      const practice = await getPracticeSession(sessionId, session.user.id, session.workspace.id);
      if (!practice) {
        return { response: jsonError("Practice session not found.", 404) };
      }

      const transcript = readTranscript(practice.transcriptJson);
      const storedSummary = readPracticeSummary(practice.summaryJson);
      const format = practice.format === "POLICY" ? "Policy" : practice.format === "CUSTOM" ? "Custom" : practice.format;
      const side = practice.side === "AFF" ? "Aff" : practice.side === "NEG" ? "Neg" : practice.side === "PRO" ? "Pro" : practice.side === "CON" ? "Con" : "Generic";

      // Build prompt context: for long transcripts, feed a rolling summary + only
      // the most recent turns instead of hard-truncating and losing early context.
      const useSummary = transcript.length > SUMMARY_TRIGGER_ENTRIES;
      const recentTranscript = useSummary
        ? transcript.slice(-KEEP_RECENT_ENTRIES)
        : transcript.slice(-MAX_TRANSCRIPT_TURNS);
      const conversationSummary = useSummary ? storedSummary.summary : "";

      // Round-aware：从赛制发言序列 + 用户已发言轮数推出当前 round 状态。
      const mode: PracticeMode = isPracticeMode(practice.mode) ? practice.mode : "text-spar";
      const userTurns = transcript.filter((turn) => turn.role === "user").length;
      const roundState = getPracticeRoundState({ format, side, userTurns, mode });

      const promptInput = {
        topic: practice.topic,
        format,
        side,
        transcript: recentTranscript,
        userMessage: message,
        context: {
          mode,
          persona: practice.persona,
          roundState,
          speechRole: roundState.currentSpeech?.speech ?? "next speech",
          roundPhase: roundState.phaseLabel,
          rubricFocus: readRubricFocus(practice.rubricJson),
          conversationSummary
        }
      } as const;

      if (body.copyPromptOnly) {
        return { response: NextResponse.json({ prompt: buildPracticeOpponentCopyPrompt(promptInput) }) };
      }

      const resolved = await resolveAIProvider({ userId: session.user.id, workspaceId: session.workspace.id });
      const provider = resolved.provider;
      const reply = await generatePracticeOpponentReply({
        provider,
        ...promptInput
      });

      const latestPractice = await getPracticeSession(sessionId, session.user.id, session.workspace.id);
      if (!latestPractice) {
        return { response: jsonError("Practice session not found.", 404) };
      }
      const latestTranscript = readTranscript(latestPractice.transcriptJson);
      const nextTranscript = [...latestTranscript, { role: "user" as const, content: message }, { role: "assistant" as const, content: reply }];

      // Roll the summary forward when the transcript is long: compress the turns
      // between what the summary already covers and the KEEP_RECENT tail.
      const latestSummary = readPracticeSummary(latestPractice.summaryJson);
      let compressedSummaryJson: { summary: string; coveredTurns: number } | null = null;
      if (nextTranscript.length > SUMMARY_TRIGGER_ENTRIES) {
        const compressUpTo = nextTranscript.length - KEEP_RECENT_ENTRIES;
        const startAt = Math.min(Math.max(latestSummary.coveredTurns, 0), compressUpTo);
        const turnsToCompress = nextTranscript.slice(startAt, compressUpTo);
        if (turnsToCompress.length > 0) {
          try {
            const summaryText = await summarizePracticeTranscript({
              provider,
              topic: latestPractice.topic,
              format,
              side,
              priorSummary: latestSummary.summary,
              turnsToCompress
            });
            compressedSummaryJson = { summary: summaryText, coveredTurns: compressUpTo };

            const summaryUsage = estimateAIUsageCost({
              providerId: resolved.providerId,
              model: resolved.model,
              input: turnsToCompress,
              output: summaryText
            });
            await db.aIRequestLog.create({
              data: {
                userId: session.user.id,
                provider: resolved.providerId,
                model: summaryUsage.model,
                taskType: "practice-summary",
                source: resolved.source,
                inputTokenEstimate: summaryUsage.inputTokenEstimate,
                outputTokenEstimate: summaryUsage.outputTokenEstimate,
                costEstimateCents: summaryUsage.costEstimateCents,
                requestStatus: "success"
              }
            }).catch((error) => {
              console.error("Failed to write AIRequestLog", error);
            });
          } catch (error) {
            // Compression is best-effort; never fail the reply because summarizing failed.
            console.error("Failed to compress practice transcript", error);
          }
        }
      }

      await db.practiceSession.update({
        where: { id: latestPractice.id },
        data: {
          transcriptJson: nextTranscript,
          aiProvider: resolved.providerId,
          ...(compressedSummaryJson ? { summaryJson: compressedSummaryJson } : {})
        }
      });

      const usage = estimateAIUsageCost({
        providerId: resolved.providerId,
        model: resolved.model,
        input: promptInput,
        output: reply
      });

      await db.aIRequestLog.create({
        data: {
          userId: session.user.id,
          provider: resolved.providerId,
          model: usage.model,
          taskType: "practice-reply",
          source: resolved.source,
          inputTokenEstimate: usage.inputTokenEstimate,
          outputTokenEstimate: usage.outputTokenEstimate,
          costEstimateCents: usage.costEstimateCents,
          requestStatus: "success"
        }
      }).catch((error) => {
        console.error("Failed to write AIRequestLog", error);
      });

      return { response: NextResponse.json({ reply, transcript: nextTranscript }) };
    });

    return result.response;
  } catch (error) {
    return routeErrorResponse(error, "Practice response failed.");
  }
}
