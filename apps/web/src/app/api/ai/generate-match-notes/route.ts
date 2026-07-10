import { NextResponse } from "next/server";
import { estimateAIUsageCost } from "@debate/ai";
import { buildMatchNotesCopyPrompt, generateMatchNotesDraft } from "@debate/ai/match-notes";
import { db } from "@debate/db";
import type { Side } from "@debate/shared";
import { requireUser } from "@/lib/auth";
import { resolveAIProvider } from "@/lib/ai-config";
import { checkRateLimit, jsonError, limitString, readLimitedJson, routeErrorResponse } from "@/lib/api-route-utils";
import { mapEvidence } from "@/lib/data";

const MAX_BODY_BYTES = 64_000;
const MAX_EVIDENCE_IDS = 8;
const MAX_OPPONENT_CONTEXT_LENGTH = 4_000;
const VALID_SIDES: Side[] = ["Aff", "Neg", "Pro", "Con", "Generic"];

function parseEvidenceIds(value: unknown) {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).slice(0, MAX_EVIDENCE_IDS) : [];
}

export async function POST(request: Request) {
  const session = await requireUser();

  try {
    if (!checkRateLimit(`${session.user.id}:match-notes`, 5, 60_000)) {
      return jsonError("AI draft requests are rate limited. Please try again shortly.", 429);
    }

    const { body, response } = await readLimitedJson<{
      matchId?: string;
      side?: Side;
      evidenceIds?: string[];
      opponentContext?: string;
      consentToSendEvidence?: boolean;
      copyPromptOnly?: boolean;
    }>(request, MAX_BODY_BYTES);
    if (response) {
      return response;
    }

    if (!body?.copyPromptOnly && !body?.consentToSendEvidence) {
      return jsonError("需要先勾选同意发送所选 evidence 给服务器端 AI provider。", 400);
    }

    const evidenceIds = parseEvidenceIds(body.evidenceIds);
    if (evidenceIds.length === 0) {
      return jsonError("请至少选择一条 evidence。", 400);
    }

    if (Array.isArray(body.evidenceIds) && body.evidenceIds.length > MAX_EVIDENCE_IDS) {
      return jsonError(`一次最多选择 ${MAX_EVIDENCE_IDS} 条 evidence。`, 400);
    }

    const opponentContext = limitString(body.opponentContext, MAX_OPPONENT_CONTEXT_LENGTH);
    if (typeof body.opponentContext === "string" && body.opponentContext.trim().length > MAX_OPPONENT_CONTEXT_LENGTH) {
      return jsonError(`Opponent context 最多 ${MAX_OPPONENT_CONTEXT_LENGTH} 个字符。`, 400);
    }

    if (body.matchId) {
      const match = await db.match.findFirst({ where: { id: body.matchId, workspaceId: session.workspace.id, deletedAt: null } });
      if (!match) {
        return jsonError("Match not found", 404);
      }
    }

    const evidenceRecords = await db.evidence.findMany({
      where: {
        id: { in: evidenceIds },
        document: { workspaceId: session.workspace.id, deletedAt: null }
      }
    });

    const speechEvidence = evidenceRecords.map(mapEvidence);
    if (speechEvidence.length === 0) {
      return jsonError("没有找到当前账号可用的 evidence。", 400);
    }

    const promptInput = {
      side: body.side && VALID_SIDES.includes(body.side) ? body.side : "Generic",
      speechEvidence,
      opponentContext
    };

    if (body.copyPromptOnly) {
      return NextResponse.json({
        prompt: buildMatchNotesCopyPrompt(promptInput)
      });
    }

    const resolved = await resolveAIProvider({ userId: session.user.id, workspaceId: session.workspace.id });
    const provider = resolved.provider;
    const draft = await generateMatchNotesDraft({
      provider,
      ...promptInput
    });
    const usage = estimateAIUsageCost({
      providerId: resolved.providerId,
      model: resolved.model,
      input: promptInput,
      output: draft
    });

    await db.aIRequestLog.create({
      data: {
        userId: session.user.id,
        provider: resolved.providerId,
        model: usage.model,
        taskType: "match-notes",
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
      draft
    });
  } catch (error) {
    return routeErrorResponse(error, "AI draft failed.");
  }
}
