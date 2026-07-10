import { NextResponse } from "next/server";
import { estimateAIUsageCost } from "@debate/ai";
import { buildPracticeDrillsCopyPrompt, generatePracticeDrills } from "@debate/ai/practice";
import { getPracticeRoundState, isPracticeMode, type PracticeMode } from "@debate/shared";
import { db } from "@debate/db";
import { requireUser } from "@/lib/auth";
import { resolveAIProvider } from "@/lib/ai-config";
import { checkRateLimit, jsonError, readLimitedJson, routeErrorResponse } from "@/lib/api-route-utils";
import { getPracticeSession, readRubricFocus, readTranscript } from "@/lib/data";

const MAX_BODY_BYTES = 8_000;
const MAX_TRANSCRIPT_TURNS = 12;

export async function POST(request: Request) {
  const session = await requireUser();

  try {
    if (!checkRateLimit(`${session.user.id}:practice-drill`, 5, 60_000)) {
      return jsonError("Practice drill requests are rate limited. Please try again shortly.", 429);
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
        roundPhase: roundState.phaseLabel,
        rubricFocus: readRubricFocus(practice.rubricJson)
      }
    } as const;

    if (body.copyPromptOnly) {
      return NextResponse.json({ prompt: buildPracticeDrillsCopyPrompt(promptInput) });
    }

    const resolved = await resolveAIProvider({ userId: session.user.id, workspaceId: session.workspace.id });
    const provider = resolved.provider;
    const { drills } = await generatePracticeDrills({ provider, ...promptInput });

    // Drill 持久化到 session，刷新后仍可回看。
    await db.practiceSession.update({
      where: { id: practice.id },
      data: { drillsJson: JSON.parse(JSON.stringify(drills)), aiProvider: resolved.providerId }
    });

    const usage = estimateAIUsageCost({
      providerId: resolved.providerId,
      model: resolved.model,
      input: promptInput,
      output: drills
    });

    await db.aIRequestLog.create({
      data: {
        userId: session.user.id,
        provider: resolved.providerId,
        model: usage.model,
        taskType: "practice-drill",
        source: resolved.source,
        inputTokenEstimate: usage.inputTokenEstimate,
        outputTokenEstimate: usage.outputTokenEstimate,
        costEstimateCents: usage.costEstimateCents,
        requestStatus: "success"
      }
    }).catch((error) => {
      console.error("Failed to write AIRequestLog", error);
    });

    return NextResponse.json({ drills });
  } catch (error) {
    return routeErrorResponse(error, "Practice drill generation failed.");
  }
}
