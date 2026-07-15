"use server";

import { revalidatePath } from "next/cache";
import { db } from "@debate/db";
import type { FlowCellStatus, FlowResponse, FlowResponseKind, Side } from "@debate/shared";
import { requireUser } from "@/lib/auth";
import { flowStatusToPrisma, mapFlowResponse, sideToPrisma } from "@/lib/mappers";
import { readStringArray } from "@/lib/data";
import { requireRoomAccess, touchRoomByMatchId } from "@/lib/rooms";

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

  await requireRoomAccess(matchId, session.user.id, session.user.isSystemAdmin);
  const match = await db.match.findFirst({
    where: { id: matchId, deletedAt: null },
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
  await touchRoomByMatchId(match.id);

  revalidatePath("/app/matches");
}

export async function saveFlowCell(formData: FormData) {
  const session = await requireUser();
  const cellId = requiredText(formData, "cellId");
  const content = String(formData.get("content") ?? "");
  const status = String(formData.get("status") ?? "open") as FlowCellStatus;
  const evidenceIds = readStringArray(formData.get("evidenceIds"));
  const cell = await db.flowCell.findUnique({ where: { id: cellId }, select: { flowRow: { select: { matchId: true } } } });
  if (!cell) throw new Error("Flow cell not found");
  await requireRoomAccess(cell.flowRow.matchId, session.user.id, session.user.isSystemAdmin);

  await db.flowCell.updateMany({
    where: { id: cellId },
    data: {
      content,
      status: flowStatusToPrisma[status] ?? "OPEN",
      evidenceIdsJson: evidenceIds
    }
  });
  await touchRoomByMatchId(cell.flowRow.matchId);

  revalidatePath("/app/matches");
}

export async function deleteFlowRow(formData: FormData) {
  const session = await requireUser();
  const flowRowId = requiredText(formData, "flowRowId");
  const row = await db.flowRow.findUnique({ where: { id: flowRowId }, select: { matchId: true } });
  if (!row) throw new Error("Flow row not found");
  await requireRoomAccess(row.matchId, session.user.id, session.user.isSystemAdmin);

  await db.flowRow.deleteMany({ where: { id: flowRowId } });
  await touchRoomByMatchId(row.matchId);

  revalidatePath("/app/matches");
}

// 用关系过滤把 cell 收窄到当前 workspace，防止跨 workspace 写入 line-by-line response。
export async function addFlowResponse(formData: FormData): Promise<FlowResponse> {
  const session = await requireUser();
  const cellId = requiredText(formData, "cellId");
  const side = String(formData.get("side") ?? "Generic") as Side;
  const rawKind = String(formData.get("kind") ?? "response") as FlowResponseKind;
  const kind = FLOW_RESPONSE_KINDS.includes(rawKind) ? rawKind : "response";
  const content = String(formData.get("content") ?? "");
  const evidenceIds = readStringArray(formData.get("evidenceIds"));

  const cell = await db.flowCell.findFirst({
    where: { id: cellId },
    include: { flowRow: { select: { matchId: true } }, _count: { select: { responses: true } } }
  });
  if (!cell) {
    throw new Error("Flow cell not found");
  }
  await requireRoomAccess(cell.flowRow.matchId, session.user.id, session.user.isSystemAdmin);

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
  await touchRoomByMatchId(cell.flowRow.matchId);

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
  const response = await db.flowResponse.findUnique({
    where: { id: responseId },
    select: { flowCell: { select: { flowRow: { select: { matchId: true } } } } }
  });
  if (!response) throw new Error("Flow response not found");
  const matchId = response.flowCell.flowRow.matchId;
  await requireRoomAccess(matchId, session.user.id, session.user.isSystemAdmin);

  await db.flowResponse.updateMany({
    where: { id: responseId },
    data: {
      content,
      status: flowStatusToPrisma[status] ?? "OPEN",
      kind,
      evidenceIdsJson: evidenceIds
    }
  });
  await touchRoomByMatchId(matchId);

  revalidatePath("/app/matches");
}

export async function deleteFlowResponse(formData: FormData) {
  const session = await requireUser();
  const responseId = requiredText(formData, "responseId");
  const response = await db.flowResponse.findUnique({
    where: { id: responseId },
    select: { flowCell: { select: { flowRow: { select: { matchId: true } } } } }
  });
  if (!response) throw new Error("Flow response not found");
  const matchId = response.flowCell.flowRow.matchId;
  await requireRoomAccess(matchId, session.user.id, session.user.isSystemAdmin);

  await db.flowResponse.deleteMany({ where: { id: responseId } });
  await touchRoomByMatchId(matchId);

  revalidatePath("/app/matches");
}

export async function saveFlowWeighing(formData: FormData) {
  const session = await requireUser();
  const flowRowId = requiredText(formData, "flowRowId");
  const row = await db.flowRow.findUnique({ where: { id: flowRowId }, select: { matchId: true } });
  if (!row) throw new Error("Flow row not found");
  await requireRoomAccess(row.matchId, session.user.id, session.user.isSystemAdmin);

  await db.flowRow.updateMany({
    where: { id: flowRowId },
    data: {
      weighMagnitude: String(formData.get("magnitude") ?? ""),
      weighProbability: String(formData.get("probability") ?? ""),
      weighTimeframe: String(formData.get("timeframe") ?? ""),
      weighScope: String(formData.get("scope") ?? "")
    }
  });
  await touchRoomByMatchId(row.matchId);

  revalidatePath("/app/matches");
}
