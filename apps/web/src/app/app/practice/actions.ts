"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@debate/db";
import type { DebateFormat, Side } from "@debate/shared";
import { isAiPersona, isPracticeMode } from "@debate/shared";
import { requireUser } from "@/lib/auth";
import { formatToPrisma, sideToPrisma } from "@/lib/mappers";

function requiredText(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export async function createPracticeSession(formData: FormData) {
  const session = await requireUser();
  const format = String(formData.get("format") ?? "PF") as DebateFormat;
  const side = String(formData.get("side") ?? "Generic") as Side;
  const rawMode = String(formData.get("mode") ?? "text-spar").trim();
  const mode = isPracticeMode(rawMode) ? rawMode : "text-spar";
  const rawPersona = String(formData.get("persona") ?? "technical-opponent").trim();
  const persona = isAiPersona(rawPersona) ? rawPersona : "technical-opponent";
  const rubricFocus = String(formData.get("rubricFocus") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const created = await db.practiceSession.create({
    data: {
      userId: session.user.id,
      workspaceId: session.workspace.id,
      topic: requiredText(formData, "topic"),
      format: formatToPrisma[format] ?? "PF",
      side: sideToPrisma[side] ?? "GENERIC",
      mode,
      persona,
      aiProvider: process.env.AI_PROVIDER ?? "mock",
      rubricJson: rubricFocus.length ? rubricFocus : ["clash", "evidence extension", "weighing", "strategic collapse"],
      transcriptJson: [],
      scoreJson: {}
    }
  });

  revalidatePath("/app/practice");
  // Setup done -> enter the (simplified) training room for the new session.
  redirect(`/app/practice?session=${created.id}`);
}

export async function deletePracticeSession(formData: FormData) {
  const session = await requireUser();
  const id = String(formData.get("sessionId") ?? "").trim();
  if (!id) {
    throw new Error("sessionId is required");
  }

  // deleteMany carries the ownership filter, so a foreign id simply deletes nothing.
  await db.practiceSession.deleteMany({
    where: { id, userId: session.user.id, workspaceId: session.workspace.id }
  });

  revalidatePath("/app/practice");
}
