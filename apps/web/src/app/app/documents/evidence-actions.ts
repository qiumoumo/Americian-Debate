"use server";

import { revalidatePath } from "next/cache";
import { db } from "@debate/db";
import type { EvidenceDraft, Side } from "@debate/shared";
import { requireUser } from "@/lib/auth";
import { sideToPrisma } from "@/lib/mappers";
import { requireRoomAccess, touchRoomByMatchId } from "@/lib/rooms";
import { documentActorFromSession, requireDocumentAccess, type DocumentActor } from "@/lib/documents";

// ── Evidence 导入 / 编辑 / 删除 / 关联比赛的 server actions ──────────
// 全部经 requireUser() 校验 workspace 归属；返回值给 client（支持导入后撤回、
// 加入/移出比赛）。Next 15 允许 server action 接收对象参数并返回结果。

async function requireEvidenceAccess(actor: DocumentActor, evidenceId: string) {
  const evidence = await db.evidence.findFirst({
    where: { id: evidenceId, document: { workspaceId: actor.workspaceId, deletedAt: null } },
    select: { documentId: true }
  });
  if (!evidence) throw new Error("证据不存在或不属于当前工作区");
  await requireDocumentAccess(actor, evidence.documentId, "edit");
  return evidence.documentId;
}

function normalizeSourceUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export interface ImportEvidenceResult {
  created: number;
  ids: string[];
}

function requireEvidenceText(input: { title: string; claim: string; quote: string }) {
  if (!input.title.trim() || !input.claim.trim() || !input.quote.trim()) {
    throw new Error("标题、Claim 和 Quote 均不能为空");
  }
}

export interface EvidenceMutationResult {
  ok: boolean;
  message: string;
  id?: string;
}

export async function createEvidenceCard(input: {
  documentId: string;
  title: string;
  claim: string;
  quote: string;
  sourceUrl: string;
  author: string;
  publication: string;
  publishedDate: string;
  side: Side;
  tags: string[];
}): Promise<EvidenceMutationResult> {
  const session = await requireUser();
  const actor = documentActorFromSession(session);
  await requireDocumentAccess(actor, input.documentId, "edit");
  try {
    requireEvidenceText(input);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? `${error.message}。` : "证据字段不完整。" };
  }
  const created = await db.evidence.create({
    data: {
      documentId: input.documentId,
      title: input.title.trim(),
      claim: input.claim.trim(),
      quote: input.quote.trim(),
      sourceUrl: normalizeSourceUrl(input.sourceUrl),
      author: input.author.trim() || null,
      publication: input.publication.trim() || null,
      publishedDate: input.publishedDate.trim() || null,
      side: sideToPrisma[input.side] ?? "GENERIC",
      tagsJson: input.tags.map((tag) => tag.trim()).filter(Boolean),
      contentRange: {}
    },
    select: { id: true }
  });
  revalidatePath("/app/documents");
  revalidatePath(`/app/documents/${input.documentId}`);
  return { ok: true, id: created.id, message: "证据已添加。" };
}

/** 批量导入解析后的草稿卡到某文档。返回新建卡片 id，供导入后撤回。 */
export async function importEvidenceCards(input: {
  documentId: string;
  cards: EvidenceDraft[];
}): Promise<ImportEvidenceResult> {
  const session = await requireUser();
  const actor = documentActorFromSession(session);
  const document = await requireDocumentAccess(actor, input.documentId, "edit");
  const documentId = document.id;

  const ids: string[] = [];
  for (const card of input.cards) {
    const title = card.title.trim();
    const claim = card.claim.trim();
    const quote = card.quote.trim();
    if (!title && !claim && !quote) {
      continue; // 跳过完全空白的卡片。
    }
    const created = await db.evidence.create({
      data: {
        documentId,
        title: title || quote.slice(0, 80) || "Untitled card",
        claim,
        quote,
        sourceUrl: normalizeSourceUrl(card.sourceUrl),
        author: card.author?.trim() || null,
        publication: card.publication?.trim() || null,
        publishedDate: card.publishedDate?.trim() || null,
        side: sideToPrisma[card.side as Side] ?? "GENERIC",
        tagsJson: card.tags.map((tag) => tag.trim()).filter(Boolean),
        contentRange: {}
      },
      select: { id: true }
    });
    ids.push(created.id);
  }

  revalidatePath("/app/documents");
  revalidatePath(`/app/documents/${documentId}`);
  return { created: ids.length, ids };
}

/** 删除若干 evidence（限当前 workspace）。用于导入后撤回或单卡删除。 */
export async function deleteEvidenceCards(input: { ids: string[] }): Promise<{ deleted: number }> {
  const session = await requireUser();
  if (!input.ids.length) {
    return { deleted: 0 };
  }
  const actor = documentActorFromSession(session);
  const ids = [...new Set(input.ids)];
  const evidence = await db.evidence.findMany({
    where: { id: { in: ids }, document: { workspaceId: actor.workspaceId, deletedAt: null } },
    select: { id: true, documentId: true }
  });
  if (evidence.length !== ids.length) throw new Error("部分证据不存在或不属于当前工作区");
  for (const documentId of new Set(evidence.map((card) => card.documentId))) {
    await requireDocumentAccess(actor, documentId, "edit");
  }
  const result = await db.evidence.deleteMany({
    where: {
      id: { in: ids },
      document: { workspaceId: actor.workspaceId, deletedAt: null }
    }
  });
  revalidatePath("/app/documents");
  for (const documentId of new Set(evidence.map((card) => card.documentId))) revalidatePath(`/app/documents/${documentId}`);
  return { deleted: result.count };
}

/** 编辑单张 evidence 的标准化字段。 */
export async function updateEvidenceCard(input: {
  id: string;
  title: string;
  claim: string;
  quote: string;
  sourceUrl: string;
  author: string;
  publication: string;
  publishedDate: string;
  side: Side;
  tags: string[];
}): Promise<void> {
  const session = await requireUser();
  const actor = documentActorFromSession(session);
  const documentId = await requireEvidenceAccess(actor, input.id);
  requireEvidenceText(input);
  const result = await db.evidence.updateMany({
    where: { id: input.id, document: { workspaceId: actor.workspaceId, deletedAt: null } },
    data: {
      title: input.title.trim(),
      claim: input.claim.trim(),
      quote: input.quote.trim(),
      sourceUrl: normalizeSourceUrl(input.sourceUrl),
      author: input.author.trim() || null,
      publication: input.publication.trim() || null,
      publishedDate: input.publishedDate.trim() || null,
      side: sideToPrisma[input.side] ?? "GENERIC",
      tagsJson: input.tags.map((tag) => tag.trim()).filter(Boolean)
    }
  });
  if (result.count !== 1) throw new Error("证据保存失败");
  revalidatePath("/app/documents");
  revalidatePath(`/app/documents/${documentId}`);
}

/** 把一张 evidence 关联到某场比赛（幂等，靠 @@unique(matchId, evidenceId)）。 */
export async function addEvidenceToMatch(input: {
  evidenceId: string;
  matchId: string;
}): Promise<{ linked: boolean }> {
  const session = await requireUser();
  await requireRoomAccess(input.matchId, session.user.id, session.user.isSystemAdmin);
  await db.$transaction(async (tx) => {
    const [match, evidence] = await Promise.all([
      tx.match.findFirst({
        where: { id: input.matchId, deletedAt: null },
        select: { id: true, reportSubmittedAt: true }
      }),
      tx.evidence.findFirst({
        where: { id: input.evidenceId, document: { deletedAt: null, workspace: { deletedAt: null }, owner: { disabledAt: null } } },
        select: { id: true }
      })
    ]);
    if (!match || !evidence) {
      throw new Error("Match or evidence not found");
    }
    if (match.reportSubmittedAt) {
      throw new Error("Submitted report evidence must be revised from match history");
    }

    await tx.matchEvidence.upsert({
      where: { matchId_evidenceId: { matchId: match.id, evidenceId: evidence.id } },
      create: { matchId: match.id, evidenceId: evidence.id },
      update: {}
    });
  });
  await touchRoomByMatchId(input.matchId);

  revalidatePath("/app/matches");
  revalidatePath("/app/history");
  return { linked: true };
}

/** 从某场比赛移出一张 evidence。用于加入后撤回。 */
export async function removeEvidenceFromMatch(input: {
  evidenceId: string;
  matchId: string;
}): Promise<{ removed: number }> {
  const session = await requireUser();
  await requireRoomAccess(input.matchId, session.user.id, session.user.isSystemAdmin);
  const removed = await db.$transaction(async (tx) => {
    const match = await tx.match.findFirst({
      where: { id: input.matchId, deletedAt: null },
      select: { reportSubmittedAt: true }
    });
    if (!match) {
      throw new Error("Match not found");
    }
    if (match.reportSubmittedAt) {
      throw new Error("Submitted report evidence must be revised from match history");
    }
    const result = await tx.matchEvidence.deleteMany({
      where: { matchId: input.matchId, evidenceId: input.evidenceId }
    });
    return result.count;
  });
  await touchRoomByMatchId(input.matchId);
  revalidatePath("/app/matches");
  revalidatePath("/app/history");
  return { removed };
}
