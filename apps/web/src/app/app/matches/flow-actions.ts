"use server";

import { revalidatePath } from "next/cache";
import { db } from "@debate/db";
import type { FlowCellStatus, FlowResponse, FlowResponseKind, Side } from "@debate/shared";
import { requireUser } from "@/lib/auth";
import { flowStatusToPrisma, mapFlowResponse, sideToPrisma } from "@/lib/mappers";
import { readStringArray } from "@/lib/data";

const FLOW_RESPONSE_KINDS: FlowResponseKind[] = ["response", "answer", "turn", "weigh", "collapse"];

function requiredText(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export async function createFlowRow(formData: FormData) {
  const session = await requireUser();
  const matchId = requiredText(formData, "matchId");
  const side = String(formData.get("side") ?? "Generic") as Side;
  const title = String(formData.get("title") ?? "").trim();

  const match = await db.match.findFirst({
    where: { id: matchId, workspaceId: session.workspace.id, deletedAt: null },
    include: { speechNotes: { orderBy: { speechOrder: "asc" } }, flowRows: true }
  });
  if (!match) {
    throw new Error("Match not found");
  }

  await db.flowRow.create({
    data: {
      matchId: match.id,
      side: sideToPrisma[side] ?? "GENERIC",
      title,
      order: match.flowRows.length,
      cells: {
        // 只对 flowable 的 speech 生成 cell（crossfire 不 flow），保留全局 speechOrder 对齐列。
        create: match.speechNotes
          .filter((note) => note.flowable)
          .map((note) => ({
            speechType: note.speechType,
            speechOrder: note.speechOrder,
            content: "",
            evidenceIdsJson: [],
            status: "OPEN"
          }))
      }
    }
  });

  revalidatePath("/app/matches");
}

export async function saveFlowCell(formData: FormData) {
  const session = await requireUser();
  const cellId = requiredText(formData, "cellId");
  const content = String(formData.get("content") ?? "");
  const status = String(formData.get("status") ?? "open") as FlowCellStatus;
  const evidenceIds = readStringArray(formData.get("evidenceIds"));

  await db.flowCell.updateMany({
    where: {
      id: cellId,
      flowRow: { match: { workspaceId: session.workspace.id, deletedAt: null } }
    },
    data: {
      content,
      status: flowStatusToPrisma[status] ?? "OPEN",
      evidenceIdsJson: evidenceIds
    }
  });

  revalidatePath("/app/matches");
}

export async function deleteFlowRow(formData: FormData) {
  const session = await requireUser();
  const flowRowId = requiredText(formData, "flowRowId");

  await db.flowRow.deleteMany({
    where: {
      id: flowRowId,
      match: { workspaceId: session.workspace.id, deletedAt: null }
    }
  });

  revalidatePath("/app/matches");
}

// 用关系过滤把 cell 收窄到当前 workspace，防止跨 workspace 写入 line-by-line response。
const cellInWorkspace = (cellId: string, workspaceId: string) => ({
  id: cellId,
  flowRow: { match: { workspaceId, deletedAt: null } }
});

export async function addFlowResponse(formData: FormData): Promise<FlowResponse> {
  const session = await requireUser();
  const cellId = requiredText(formData, "cellId");
  const side = String(formData.get("side") ?? "Generic") as Side;
  const rawKind = String(formData.get("kind") ?? "response") as FlowResponseKind;
  const kind = FLOW_RESPONSE_KINDS.includes(rawKind) ? rawKind : "response";
  const content = String(formData.get("content") ?? "");
  const evidenceIds = readStringArray(formData.get("evidenceIds"));

  const cell = await db.flowCell.findFirst({
    where: cellInWorkspace(cellId, session.workspace.id),
    include: { _count: { select: { responses: true } } }
  });
  if (!cell) {
    throw new Error("Flow cell not found");
  }

  const created = await db.flowResponse.create({
    data: {
      flowCellId: cell.id,
      order: cell._count.responses,
      side: sideToPrisma[side] ?? "GENERIC",
      kind,
      content,
      evidenceIdsJson: evidenceIds,
      status: "OPEN"
    }
  });

  revalidatePath("/app/matches");
  return mapFlowResponse(created);
}

export async function saveFlowResponse(formData: FormData) {
  const session = await requireUser();
  const responseId = requiredText(formData, "responseId");
  const content = String(formData.get("content") ?? "");
  const status = String(formData.get("status") ?? "open") as FlowCellStatus;
  const rawKind = String(formData.get("kind") ?? "response") as FlowResponseKind;
  const kind = FLOW_RESPONSE_KINDS.includes(rawKind) ? rawKind : "response";
  const evidenceIds = readStringArray(formData.get("evidenceIds"));

  await db.flowResponse.updateMany({
    where: {
      id: responseId,
      flowCell: { flowRow: { match: { workspaceId: session.workspace.id, deletedAt: null } } }
    },
    data: {
      content,
      status: flowStatusToPrisma[status] ?? "OPEN",
      kind,
      evidenceIdsJson: evidenceIds
    }
  });

  revalidatePath("/app/matches");
}

export async function deleteFlowResponse(formData: FormData) {
  const session = await requireUser();
  const responseId = requiredText(formData, "responseId");

  await db.flowResponse.deleteMany({
    where: {
      id: responseId,
      flowCell: { flowRow: { match: { workspaceId: session.workspace.id, deletedAt: null } } }
    }
  });

  revalidatePath("/app/matches");
}

export async function saveFlowWeighing(formData: FormData) {
  const session = await requireUser();
  const flowRowId = requiredText(formData, "flowRowId");

  await db.flowRow.updateMany({
    where: {
      id: flowRowId,
      match: { workspaceId: session.workspace.id, deletedAt: null }
    },
    data: {
      weighMagnitude: String(formData.get("magnitude") ?? ""),
      weighProbability: String(formData.get("probability") ?? ""),
      weighTimeframe: String(formData.get("timeframe") ?? ""),
      weighScope: String(formData.get("scope") ?? "")
    }
  });

  revalidatePath("/app/matches");
}
