"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, Prisma } from "@debate/db";
import type { DebateFormat, Side } from "@debate/shared";
import { createInitialSharedTimer, formatConfigs } from "@debate/shared";
import { requireUser } from "@/lib/auth";
import { formatToPrisma, sideToPrisma } from "@/lib/mappers";
import { tagsToJson } from "@/lib/data";
import { allocateRoomInviteCode, joinRoomByCode, requireRoomAccess, touchRoomByMatchId } from "@/lib/rooms";

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

  const inviteCode = await allocateRoomInviteCode();
  const match = await db.$transaction(async (tx) => {
    const created = await tx.match.create({
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
    await tx.matchRoom.create({
      data: {
        matchId: created.id,
        ownerId: session.user.id,
        inviteCode,
        timerStateJson: createInitialSharedTimer(format) as unknown as Prisma.InputJsonValue,
        members: { create: { userId: session.user.id } }
      }
    });
    const flowableNotes = created.speechNotes.filter((note) => note.flowable);
    await Promise.all(config.defaultFlowRows.map((template, order) => tx.flowRow.create({
      data: {
        matchId: created.id,
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
    })));
    return created;
  });

  revalidatePath("/app/matches");
  // 创建完成 -> 直接进入这场比赛的比赛室。
  redirect(`/app/matches?match=${match.id}`);
}

export async function saveSpeechNote(formData: FormData) {
  const session = await requireUser();
  const speechNoteId = requiredText(formData, "speechNoteId");
  const notes = String(formData.get("notes") ?? "");

  const speechNote = await db.speechNote.findUnique({ where: { id: speechNoteId }, select: { matchId: true } });
  if (!speechNote) throw new Error("Speech note not found");
  await requireRoomAccess(speechNote.matchId, session.user.id, session.user.isSystemAdmin);
  await db.speechNote.updateMany({
    where: { id: speechNoteId, match: { deletedAt: null } },
    data: { notes }
  });
  await touchRoomByMatchId(speechNote.matchId);

  revalidatePath("/app/matches");
}

export async function insertAIDraft(formData: FormData) {
  const session = await requireUser();
  const matchId = requiredText(formData, "matchId");
  const draftText = requiredText(formData, "draftText");

  const match = await db.match.findFirst({ where: { id: matchId, deletedAt: null } });
  if (!match) {
    throw new Error("Match not found");
  }
  await requireRoomAccess(match.id, session.user.id, session.user.isSystemAdmin);

  await db.matchNote.create({
    data: {
      matchId: match.id,
      templateType: "ai-draft",
      contentJson: { text: draftText, insertedAt: new Date().toISOString() }
    }
  });
  await touchRoomByMatchId(match.id);

  revalidatePath("/app/matches");
}

export async function joinMatchRoom(formData: FormData) {
  const session = await requireUser();
  const code = requiredText(formData, "inviteCode");
  const room = await joinRoomByCode(code, session.user.id);
  redirect(`/app/matches?match=${room.matchId}`);
}
