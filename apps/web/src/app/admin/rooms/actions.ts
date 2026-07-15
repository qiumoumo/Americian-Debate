"use server";

import { revalidatePath } from "next/cache";
import { db } from "@debate/db";
import { requireSystemAdmin } from "@/lib/auth";
import { inviteUserToRoom, rotateRoomCode, setRoomMemberStatus, transferRoomOwnership } from "@/lib/rooms";

function value(formData: FormData, key: string) {
  const result = String(formData.get(key) ?? "").trim();
  if (!result) throw new Error(`${key} is required`);
  return result;
}

async function audit(matchId: string, actor: Awaited<ReturnType<typeof requireSystemAdmin>>, action: string, targetId?: string) {
  const match = await db.match.findUnique({ where: { id: matchId }, select: { workspaceId: true } });
  if (!match) return;
  await db.auditLog.create({ data: { workspaceId: match.workspaceId, actorUserId: actor.user.id, actorName: actor.user.name, action, targetType: "MatchRoom", targetId } });
}

export async function adminInviteToRoom(formData: FormData) {
  const session = await requireSystemAdmin();
  const matchId = value(formData, "matchId");
  const userId = value(formData, "userId");
  await inviteUserToRoom(matchId, userId, session.user.id);
  await audit(matchId, session, "room.invite", userId);
  revalidatePath("/admin/rooms");
}

export async function adminChangeRoomMember(formData: FormData) {
  const session = await requireSystemAdmin();
  const matchId = value(formData, "matchId");
  const userId = value(formData, "userId");
  const status = value(formData, "status") === "ACTIVE" ? "ACTIVE" : "REMOVED";
  await setRoomMemberStatus(matchId, userId, session.user.id, status, true);
  await audit(matchId, session, `room.member.${status.toLowerCase()}`, userId);
  revalidatePath("/admin/rooms");
}

export async function adminTransferRoomOwner(formData: FormData) {
  const session = await requireSystemAdmin();
  const matchId = value(formData, "matchId");
  const userId = value(formData, "userId");
  await transferRoomOwnership(matchId, userId, session.user.id, true);
  await audit(matchId, session, "room.owner.transfer", userId);
  revalidatePath("/admin/rooms");
}

export async function adminRotateRoomCode(formData: FormData) {
  const session = await requireSystemAdmin();
  const matchId = value(formData, "matchId");
  await rotateRoomCode(matchId, session.user.id, true);
  await audit(matchId, session, "room.code.rotate");
  revalidatePath("/admin/rooms");
}

export async function setSystemAdministrator(formData: FormData) {
  const session = await requireSystemAdmin();
  const userId = value(formData, "userId");
  const enabled = value(formData, "enabled") === "true";
  if (!enabled) {
    const count = await db.user.count({ where: { isSystemAdmin: true, disabledAt: null } });
    if (count <= 1) throw new Error("At least one system administrator is required");
  }
  await db.user.update({ where: { id: userId }, data: { isSystemAdmin: enabled } });
  await db.auditLog.create({
    data: { workspaceId: session.workspace.id, actorUserId: session.user.id, actorName: session.user.name, action: enabled ? "system_admin.grant" : "system_admin.revoke", targetType: "User", targetId: userId }
  });
  revalidatePath("/admin/rooms");
}
