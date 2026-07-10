"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@debate/db";
import type { DebateFormat, Side } from "@debate/shared";
import { formatConfigs } from "@debate/shared";
import { requireUser } from "@/lib/auth";
import { formatToPrisma, sideToPrisma } from "@/lib/mappers";
import { tagsToJson } from "@/lib/data";

function requiredText(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export async function createMatch(formData: FormData) {
  const session = await requireUser();
  const format = String(formData.get("format") ?? "PF") as DebateFormat;
  const side = String(formData.get("side") ?? "Generic") as Side;
  const config = formatConfigs[format] ?? formatConfigs.PF;
  const rawDate = String(formData.get("date") ?? "").trim();
  const date = rawDate ? new Date(rawDate) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error("date must be a valid date");
  }

  const match = await db.match.create({
    data: {
      workspaceId: session.workspace.id,
      userId: session.user.id,
      tournament: requiredText(formData, "tournament"),
      opponent: requiredText(formData, "opponent"),
      topic: requiredText(formData, "topic"),
      roundNumber: String(formData.get("roundNumber") ?? "").trim() || null,
      judge: String(formData.get("judge") ?? "").trim() || null,
      format: formatToPrisma[format] ?? "PF",
      side: sideToPrisma[side] ?? "GENERIC",
      date,
      tagsJson: tagsToJson(String(formData.get("tags") ?? "")),
      speechNotes: {
        // speechOrder 为含 crossfire 的全局序号（index+1），永不重编号，供 flow 列/格按序对齐。
        create: config.speeches.map((speech, index) => ({
          speakerSide: sideToPrisma[speech.side] ?? sideToPrisma[side] ?? "GENERIC",
          speechType: speech.speech,
          speechOrder: index + 1,
          kind: speech.kind,
          flowable: speech.flowable,
          timerDurationMs: speech.durationMs,
          notes: ""
        }))
      }
    },
    include: { speechNotes: { orderBy: { speechOrder: "asc" } } }
  });

  // 按赛制预置 flow 行（LD 的 Value/Criterion/Framework、Policy 的 case + off-case）。
  // cell 只对 flowable 的 speech 生成，且保留全局 speechOrder，以对齐列并满足 @@unique 约束。
  if (config.defaultFlowRows.length) {
    const flowableNotes = match.speechNotes.filter((note) => note.flowable);
    await db.$transaction(
      config.defaultFlowRows.map((template, order) =>
        db.flowRow.create({
          data: {
            matchId: match.id,
            side: sideToPrisma[template.side] ?? "GENERIC",
            title: template.title,
            category: template.category,
            order,
            cells: {
              create: flowableNotes.map((note) => ({
                speechType: note.speechType,
                speechOrder: note.speechOrder,
                content: "",
                evidenceIdsJson: [],
                status: "OPEN"
              }))
            }
          }
        })
      )
    );
  }

  revalidatePath("/app/matches");
  // 创建完成 -> 直接进入这场比赛的比赛室。
  redirect(`/app/matches?match=${match.id}`);
}

export async function saveSpeechNote(formData: FormData) {
  const session = await requireUser();
  const speechNoteId = requiredText(formData, "speechNoteId");
  const notes = String(formData.get("notes") ?? "");

  await db.speechNote.updateMany({
    where: { id: speechNoteId, match: { workspaceId: session.workspace.id, deletedAt: null } },
    data: { notes }
  });

  revalidatePath("/app/matches");
}

export async function insertAIDraft(formData: FormData) {
  const session = await requireUser();
  const matchId = requiredText(formData, "matchId");
  const draftText = requiredText(formData, "draftText");

  const match = await db.match.findFirst({ where: { id: matchId, workspaceId: session.workspace.id, deletedAt: null } });
  if (!match) {
    throw new Error("Match not found");
  }

  await db.matchNote.create({
    data: {
      matchId: match.id,
      templateType: "ai-draft",
      contentJson: { text: draftText, insertedAt: new Date().toISOString() }
    }
  });

  revalidatePath("/app/matches");
}
