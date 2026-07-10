"use server";

import { revalidatePath } from "next/cache";
import { db } from "@debate/db";
import type { DebateFormat } from "@debate/shared";
import { requireUser } from "@/lib/auth";
import { formatToPrisma, parseTimestampToSeconds } from "@/lib/mappers";
import { tagsToJson } from "@/lib/data";

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

export async function createRound(formData: FormData) {
  const session = await requireUser();
  await db.libraryRound.create({
    data: {
      workspaceId: session.workspace.id,
      createdByUserId: session.user.id,
      ...roundFields(formData)
    }
  });
  revalidatePath("/app/library");
}

export async function updateRound(formData: FormData) {
  const session = await requireUser();
  const roundId = requiredText(formData, "roundId");
  await db.libraryRound.updateMany({
    where: { id: roundId, workspaceId: session.workspace.id, deletedAt: null },
    data: roundFields(formData)
  });
  revalidatePath("/app/library");
}

export async function deleteRound(formData: FormData) {
  const session = await requireUser();
  const roundId = requiredText(formData, "roundId");
  await db.libraryRound.updateMany({
    where: { id: roundId, workspaceId: session.workspace.id, deletedAt: null },
    data: { deletedAt: new Date() }
  });
  revalidatePath("/app/library");
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
}

export async function deleteNote(formData: FormData) {
  const session = await requireUser();
  const noteId = requiredText(formData, "noteId");
  // owner + workspace 双重限定：只能删自己在本 workspace 的笔记。
  await db.roundVideoNote.deleteMany({
    where: { id: noteId, userId: session.user.id, round: { workspaceId: session.workspace.id } }
  });
  revalidatePath("/app/library");
}
