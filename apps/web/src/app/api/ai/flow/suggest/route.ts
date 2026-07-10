import { NextResponse } from "next/server";
import { estimateAIUsageCost } from "@debate/ai";
import { buildFlowRebuttalCopyPrompt, generateFlowRebuttalSuggestions } from "@debate/ai/flow";
import { db } from "@debate/db";
import type { Side } from "@debate/shared";
import { requireUser } from "@/lib/auth";
import { resolveAIProvider } from "@/lib/ai-config";
import { checkRateLimit, jsonError, limitString, readLimitedJson, routeErrorResponse } from "@/lib/api-route-utils";
import { mapEvidence } from "@/lib/data";

const MAX_BODY_BYTES = 64_000;
const MAX_EVIDENCE_IDS = 12;
const MAX_OPPONENT_ARGUMENT_LENGTH = 4_000;
const MAX_FLOW_CONTEXT_LENGTH = 4_000;
const VALID_SIDES: Side[] = ["Aff", "Neg", "Pro", "Con", "Generic"];

function parseEvidenceIds(value: unknown) {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).slice(0, MAX_EVIDENCE_IDS) : [];
}

export async function POST(request: Request) {
  const session = await requireUser();

  try {
    if (!checkRateLimit(`${session.user.id}:flow-rebuttal`, 8, 60_000)) {
      return jsonError("AI flow requests are rate limited. Please try again shortly.", 429);
    }

    const { body, response } = await readLimitedJson<{
      matchId?: string;
      side?: Side;
      speechType?: string;
      opponentArgument?: string;
      evidenceIds?: string[];
      flowContext?: string;
      consentToSendEvidence?: boolean;
      copyPromptOnly?: boolean;
    }>(request, MAX_BODY_BYTES);
    if (response) {
      return response;
    }

    if (!body?.copyPromptOnly && !body?.consentToSendEvidence) {
      return jsonError("需要先勾选同意发送所选 evidence 给服务器端 AI provider。", 400);
    }

    const opponentArgument = limitString(body.opponentArgument, MAX_OPPONENT_ARGUMENT_LENGTH);
    if (!opponentArgument.trim()) {
      return jsonError("请先填写对方论点。", 400);
    }
    if (typeof body.opponentArgument === "string" && body.opponentArgument.trim().length > MAX_OPPONENT_ARGUMENT_LENGTH) {
      return jsonError(`对方论点最多 ${MAX_OPPONENT_ARGUMENT_LENGTH} 个字符。`, 400);
    }

    const flowContext = limitString(body.flowContext, MAX_FLOW_CONTEXT_LENGTH);

    if (body.matchId) {
      const match = await db.match.findFirst({ where: { id: body.matchId, workspaceId: session.workspace.id, deletedAt: null } });
      if (!match) {
        return jsonError("Match not found", 404);
      }
    }

    const evidenceIds = parseEvidenceIds(body.evidenceIds);
    const evidenceRecords = evidenceIds.length
      ? await db.evidence.findMany({
          where: {
            id: { in: evidenceIds },
            document: { workspaceId: session.workspace.id, deletedAt: null }
          }
        })
      : [];

    const evidence = evidenceRecords.map(mapEvidence);

    const promptInput = {
      side: body.side && VALID_SIDES.includes(body.side) ? body.side : "Generic",
      speechType: limitString(body.speechType, 120) || "Rebuttal",
      opponentArgument,
      evidence,
      flowContext
    };

    if (body.copyPromptOnly) {
      return NextResponse.json({
        prompt: buildFlowRebuttalCopyPrompt(promptInput)
      });
    }

    const resolved = await resolveAIProvider({ userId: session.user.id, workspaceId: session.workspace.id });
    const provider = resolved.provider;
    const suggestions = await generateFlowRebuttalSuggestions({
      provider,
      ...promptInput
    });
    const usage = estimateAIUsageCost({
      providerId: resolved.providerId,
      model: resolved.model,
      input: promptInput,
      output: suggestions
    });

    await db.aIRequestLog.create({
      data: {
        userId: session.user.id,
        provider: resolved.providerId,
        model: usage.model,
        taskType: "flow-rebuttal",
        source: resolved.source,
        inputTokenEstimate: usage.inputTokenEstimate,
        outputTokenEstimate: usage.outputTokenEstimate,
        costEstimateCents: usage.costEstimateCents,
        requestStatus: "success"
      }
    }).catch((error) => {
      console.error("Failed to write AIRequestLog", error);
    });

    return NextResponse.json({
      provider: resolved.providerId,
      model: usage.model,
      suggestions
    });
  } catch (error) {
    return routeErrorResponse(error, "AI flow rebuttal failed.");
  }
}
