import { NextResponse } from "next/server";
import { estimateAIUsageCost } from "@debate/ai";
import { buildPracticeFeedbackCopyPrompt, generatePracticeFeedback } from "@debate/ai/practice";
import { getPracticeRoundState, isPracticeMode, type PracticeMode } from "@debate/shared";
import { db } from "@debate/db";
import { requireUser } from "@/lib/auth";
import { resolveAIProvider } from "@/lib/ai-config";
import { checkRateLimit, jsonError, readLimitedJson, routeErrorResponse } from "@/lib/api-route-utils";
import { getPracticeSession, readPracticeSummary, readRubricFocus, readTranscript } from "@/lib/data";

const MAX_BODY_BYTES = 8_000;
const MAX_TRANSCRIPT_TURNS = 40;

export async function POST(request: Request) {
  const session = await requireUser();

  try {
    if (!checkRateLimit(`${session.user.id}:practice-feedback`, 5, 60_000)) {
      return jsonError("Practice feedback requests are rate limited. Please try again shortly.", 429);
    }

    const { body, response } = await readLimitedJson<{ sessionId?: string; copyPromptOnly?: boolean }>(request, MAX_BODY_BYTES);
    if (response) {
      return response;
    }
    if (!body) {
      return jsonError("Request body is required.", 400);
    }

    const sessionId = String(body?.sessionId ?? "").trim();
    if (!sessionId) {
      return jsonError("Practice session is required.", 400);
    }

    const practice = await getPracticeSession(sessionId, session.user.id, session.workspace.id);
    if (!practice) {
      return jsonError("Practice session not found.", 404);
    }

    const fullTranscript = readTranscript(practice.transcriptJson);
    const transcript = fullTranscript.slice(-MAX_TRANSCRIPT_TURNS);
    // When the transcript was truncated for the prompt, hand the coach the rolling
    // summary so it grades the whole session, not just the last 40 turns.
    const conversationSummary = fullTranscript.length > MAX_TRANSCRIPT_TURNS
      ? readPracticeSummary(practice.summaryJson).summary
      : "";

    const format = practice.format === "POLICY" ? "Policy" : practice.format === "CUSTOM" ? "Custom" : practice.format;
    const side = practice.side === "AFF" ? "Aff" : practice.side === "NEG" ? "Neg" : practice.side === "PRO" ? "Pro" : practice.side === "CON" ? "Con" : "Generic";
    const mode: PracticeMode = isPracticeMode(practice.mode) ? practice.mode : "text-spar";
    const userTurns = fullTranscript.filter((turn) => turn.role === "user").length;
    const roundState = getPracticeRoundState({ format, side, userTurns, mode });

    const promptInput = {
      topic: practice.topic,
      format,
      side,
      transcript,
      context: {
        mode,
        persona: practice.persona,
        roundState,
        speechRole: roundState.currentSpeech?.speech ?? "full practice transcript",
        roundPhase: "post-practice feedback",
        rubricFocus: readRubricFocus(practice.rubricJson),
        conversationSummary
      }
    } as const;

    if (body.copyPromptOnly) {
      return NextResponse.json({ prompt: buildPracticeFeedbackCopyPrompt(promptInput) });
    }

    const resolved = await resolveAIProvider({ userId: session.user.id, workspaceId: session.workspace.id });
    const provider = resolved.provider;
    const feedback = await generatePracticeFeedback({
      provider,
      ...promptInput
    });

    await db.practiceSession.update({
      where: { id: practice.id },
      data: { scoreJson: JSON.parse(JSON.stringify(feedback)), aiProvider: resolved.providerId }
    });

    const usage = estimateAIUsageCost({
      providerId: resolved.providerId,
      model: resolved.model,
      input: promptInput,
      output: feedback
    });

    await db.aIRequestLog.create({
      data: {
        userId: session.user.id,
        provider: resolved.providerId,
        model: usage.model,
        taskType: "practice-feedback",
        source: resolved.source,
        inputTokenEstimate: usage.inputTokenEstimate,
        outputTokenEstimate: usage.outputTokenEstimate,
        costEstimateCents: usage.costEstimateCents,
        requestStatus: "success"
      }
    }).catch((error) => {
      console.error("Failed to write AIRequestLog", error);
    });

    return NextResponse.json({ feedback });
  } catch (error) {
    return routeErrorResponse(error, "Practice scoring failed.");
  }
}
