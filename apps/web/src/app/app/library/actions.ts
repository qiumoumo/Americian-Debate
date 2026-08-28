"use server";

import { revalidatePath } from "next/cache";
import { db } from "@debate/db";
import type { DebateFormat } from "@debate/shared";
import { requireUser } from "@/lib/auth";
import { formatToPrisma, parseTimestampToSeconds } from "@/lib/mappers";
import { tagsToJson } from "@/lib/data";
import {
  canCreateLibraryRound,
  canManageLibraryRound,
  libraryActorFromSession,
  requireLibraryRoundAccess
} from "@/lib/library";

export interface LibraryActionResult {
  ok: boolean;
  message: string;
  roundId?: string;
}

function requiredText(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

/** 校验并规范化视频 URL：必须是 http/https，否则拒绝（挡掉 javascript:/data: 等）。 */
function requireVideoUrl(formData: FormData) {
  const raw = requiredText(formData, "videoUrl");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("videoUrl must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("videoUrl must use http or https");
  }
  return raw;
}

function roundFields(formData: FormData) {
  const format = String(formData.get("format") ?? "PF") as DebateFormat;
  return {
    title: requiredText(formData, "title"),
    videoUrl: requireVideoUrl(formData),
    description: String(formData.get("description") ?? "").trim(),
    topic: String(formData.get("topic") ?? "").trim(),
    teams: String(formData.get("teams") ?? "").trim(),
    year: String(formData.get("year") ?? "").trim(),
    tournament: String(formData.get("tournament") ?? "").trim(),
    format: formatToPrisma[format] ?? "PF",
    tagsJson: tagsToJson(String(formData.get("tags") ?? ""))
  };
}

export async function createRound(formData: FormData): Promise<LibraryActionResult> {
  const session = await requireUser();
  const actor = libraryActorFromSession(session);
  if (!canCreateLibraryRound(actor)) return { ok: false, message: "只读成员不能创建素材。" };
  try {
    const created = await db.libraryRound.create({
      data: {
        workspaceId: session.workspace.id,
        createdByUserId: session.user.id,
        ...roundFields(formData)
      },
      select: { id: true }
    });
    revalidatePath("/app/library");
    return { ok: true, roundId: created.id, message: "素材已创建。" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "素材创建失败。" };
  }
}

export async function updateRound(formData: FormData): Promise<LibraryActionResult> {
  const session = await requireUser();
  const roundId = requiredText(formData, "roundId");
  try {
    const actor = libraryActorFromSession(session);
    await requireLibraryRoundAccess(actor, roundId, "edit");
    const result = await db.libraryRound.updateMany({
      where: { id: roundId, workspaceId: session.workspace.id, deletedAt: null },
      data: roundFields(formData)
    });
    if (result.count !== 1) throw new Error("素材保存失败");
    revalidatePath("/app/library");
    revalidatePath(`/app/library/${roundId}`);
    return { ok: true, roundId, message: "素材改动已保存。" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "素材保存失败。" };
  }
}

export async function deleteRound(formData: FormData): Promise<LibraryActionResult> {
  const session = await requireUser();
  const roundId = requiredText(formData, "roundId");
  try {
    await requireLibraryRoundAccess(libraryActorFromSession(session), roundId, "delete");
    const result = await db.libraryRound.updateMany({
      where: { id: roundId, workspaceId: session.workspace.id, deletedAt: null },
      data: { deletedAt: new Date() }
    });
    if (result.count !== 1) throw new Error("素材删除失败");
    return { ok: true, roundId, message: "素材已删除。" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "素材删除失败。" };
  }
}

export async function restoreRound(formData: FormData): Promise<LibraryActionResult> {
  const session = await requireUser();
  const roundId = requiredText(formData, "roundId");
  try {
    const cutoff = new Date(Date.now() - 5_000);
    const round = await db.libraryRound.findFirst({
      where: { id: roundId, workspaceId: session.workspace.id, deletedAt: { gte: cutoff } },
      select: { createdByUserId: true }
    });
    if (!round) throw new Error("撤回窗口已结束，这份素材无法恢复");
    if (!canManageLibraryRound(libraryActorFromSession(session), round.createdByUserId)) {
      throw new Error("没有恢复这份素材的权限");
    }
    const result = await db.libraryRound.updateMany({
      where: { id: roundId, workspaceId: session.workspace.id, deletedAt: { gte: cutoff } },
      data: { deletedAt: null }
    });
    if (result.count !== 1) throw new Error("素材恢复失败");
    revalidatePath("/app/library");
    revalidatePath(`/app/library/${roundId}`);
    return { ok: true, roundId, message: "素材已恢复。" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "素材恢复失败。" };
  }
}

export async function addNote(formData: FormData) {
  const session = await requireUser();
  const roundId = requiredText(formData, "roundId");
  const body = requiredText(formData, "body");

  // 确认 round 属于本 workspace 再写笔记。
  const round = await db.libraryRound.findFirst({
    where: { id: roundId, workspaceId: session.workspace.id, deletedAt: null }
  });
  if (!round) {
    throw new Error("Round not found");
  }

  await db.roundVideoNote.create({
    data: {
      roundId,
      userId: session.user.id,
      timestampSeconds: parseTimestampToSeconds(String(formData.get("timestamp") ?? "")),
      body
    }
  });
  revalidatePath("/app/library");
  revalidatePath(`/app/library/${roundId}`);
}

export async function deleteNote(formData: FormData) {
  const session = await requireUser();
  const noteId = requiredText(formData, "noteId");
  // owner + workspace 双重限定：只能删自己在本 workspace 的笔记。
  await db.roundVideoNote.deleteMany({
    where: { id: noteId, userId: session.user.id, round: { workspaceId: session.workspace.id } }
  });
  revalidatePath("/app/library");
  const roundId = String(formData.get("roundId") ?? "").trim();
  if (roundId) revalidatePath(`/app/library/${roundId}`);
}
