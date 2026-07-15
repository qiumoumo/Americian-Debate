"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { rotateRoomCode, setRoomMemberStatus, transferRoomOwnership } from "@/lib/rooms";

function value(formData: FormData, key: string) {
  const result = String(formData.get(key) ?? "").trim();
  if (!result) throw new Error(`${key} is required`);
  return result;
}

export async function rotateMatchRoomCode(formData: FormData) {
  const session = await requireUser();
  await rotateRoomCode(value(formData, "matchId"), session.user.id, session.user.isSystemAdmin);
  revalidatePath("/app/matches");
}

export async function changeMatchRoomMember(formData: FormData) {
  const session = await requireUser();
  const status = value(formData, "status") === "ACTIVE" ? "ACTIVE" : "REMOVED";
  await setRoomMemberStatus(value(formData, "matchId"), value(formData, "userId"), session.user.id, status, session.user.isSystemAdmin);
  revalidatePath("/app/matches");
}

export async function transferMatchRoomOwner(formData: FormData) {
  const session = await requireUser();
  await transferRoomOwnership(value(formData, "matchId"), value(formData, "userId"), session.user.id, session.user.isSystemAdmin);
  revalidatePath("/app/matches");
}
