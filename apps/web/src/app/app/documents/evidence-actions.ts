"use server";

import { revalidatePath } from "next/cache";
import { db } from "@debate/db";
import type { EvidenceDraft, Side } from "@debate/shared";
import { requireUser } from "@/lib/auth";
import { sideToPrisma } from "@/lib/mappers";
import { requireRoomAccess, touchRoomByMatchId } from "@/lib/rooms";

// ── Evidence 导入 / 编辑 / 删除 / 关联比赛的 server actions ──────────
// 全部经 requireUser() 校验 workspace 归属；返回值给 client（支持导入后撤回、
// 加入/移出比赛）。Next 15 允许 server action 接收对象参数并返回结果。

/** 校验目标文档属于当前 workspace，返回其 id。 */
async function assertOwnedDocument(documentId: string, userId: string, isSystemAdmin: boolean) {
  const document = await db.document.findFirst({
    where: { id: documentId, deletedAt: null, ...(isSystemAdmin ? {} : { ownerId: userId }) },
    select: { id: true }
  });
  if (!document) {
    throw new Error("Document not found");
  }
  return document.id;
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

/** 批量导入解析后的草稿卡到某文档。返回新建卡片 id，供导入后撤回。 */
export async function importEvidenceCards(input: {
  documentId: string;
  cards: EvidenceDraft[];
}): Promise<ImportEvidenceResult> {
  const session = await requireUser();
  const documentId = await assertOwnedDocument(input.documentId, session.user.id, session.user.isSystemAdmin);

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
  return { created: ids.length, ids };
}

/** 删除若干 evidence（限当前 workspace）。用于导入后撤回或单卡删除。 */
export async function deleteEvidenceCards(input: { ids: string[] }): Promise<{ deleted: number }> {
  const session = await requireUser();
  if (!input.ids.length) {
    return { deleted: 0 };
  }
  const result = await db.evidence.deleteMany({
    where: {
      id: { in: input.ids },
      document: { deletedAt: null, ...(session.user.isSystemAdmin ? {} : { ownerId: session.user.id }) }
    }
  });
  revalidatePath("/app/documents");
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
  await db.evidence.updateMany({
    where: { id: input.id, document: { deletedAt: null, ...(session.user.isSystemAdmin ? {} : { ownerId: session.user.id }) } },
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
  revalidatePath("/app/documents");
}

/** 把一张 evidence 关联到某场比赛（幂等，靠 @@unique(matchId, evidenceId)）。 */
export async function addEvidenceToMatch(input: {
  evidenceId: string;
  matchId: string;
}): Promise<{ linked: boolean }> {
  const session = await requireUser();
  await requireRoomAccess(input.matchId, session.user.id, session.user.isSystemAdmin);
  const [match, evidence] = await Promise.all([
    db.match.findFirst({
      where: { id: input.matchId, deletedAt: null },
      select: { id: true }
    }),
    db.evidence.findFirst({
      where: { id: input.evidenceId, document: { deletedAt: null, workspace: { deletedAt: null }, owner: { disabledAt: null } } },
      select: { id: true }
    })
  ]);
  if (!match || !evidence) {
    throw new Error("Match or evidence not found");
  }

  await db.matchEvidence.upsert({
    where: { matchId_evidenceId: { matchId: match.id, evidenceId: evidence.id } },
    create: { matchId: match.id, evidenceId: evidence.id },
    update: {}
  });
  await touchRoomByMatchId(match.id);

  revalidatePath("/app/matches");
  return { linked: true };
}

/** 从某场比赛移出一张 evidence。用于加入后撤回。 */
export async function removeEvidenceFromMatch(input: {
  evidenceId: string;
  matchId: string;
}): Promise<{ removed: number }> {
  const session = await requireUser();
  await requireRoomAccess(input.matchId, session.user.id, session.user.isSystemAdmin);
  const result = await db.matchEvidence.deleteMany({
    where: {
      matchId: input.matchId,
      evidenceId: input.evidenceId,
      match: { deletedAt: null }
    }
  });
  await touchRoomByMatchId(input.matchId);
  revalidatePath("/app/matches");
  return { removed: result.count };
}
