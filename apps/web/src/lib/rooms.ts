import { randomBytes } from "node:crypto";
import { db, type DebateFormat as PrismaDebateFormat, type Prisma } from "@debate/db";
import {
  createInitialSharedTimer,
  createInviteCode,
  normalizeSharedTimer,
  type DebateFormat,
  type SharedTimerState
} from "@debate/shared";
import { mapPrismaFormat } from "./mappers.ts";

export const ONLINE_WINDOW_MS = 30_000;
export const ROOM_INVITATION_TTL_MS = 10 * 60_000;

function asTimer(value: Prisma.JsonValue): SharedTimerState {
  return value as unknown as SharedTimerState;
}

export async function allocateRoomInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = createInviteCode((length) => randomBytes(length));
    const exists = await db.matchRoom.findUnique({ where: { inviteCode: code }, select: { id: true } });
    if (!exists) return code;
  }
  throw new Error("Could not allocate a room invite code");
}

export async function createRoomForMatch(matchId: string, ownerId: string, format: PrismaDebateFormat) {
  const inviteCode = await allocateRoomInviteCode();
  return db.matchRoom.create({
    data: {
      matchId,
      ownerId,
      inviteCode,
      timerStateJson: createInitialSharedTimer(mapPrismaFormat(format)) as unknown as Prisma.InputJsonValue,
      members: { create: { userId: ownerId } }
    }
  });
}

export async function ensureRoomForMatch(matchId: string) {
  const existing = await db.matchRoom.findUnique({ where: { matchId } });
  if (existing) return existing;
  const match = await db.match.findFirst({ where: { id: matchId, deletedAt: null }, select: { id: true, userId: true, format: true } });
  if (!match) throw new Error("Match not found");
  return createRoomForMatch(match.id, match.userId, match.format);
}

export async function requireRoomAccess(matchId: string, userId: string, isSystemAdmin = false) {
  const room = await ensureRoomForMatch(matchId);
  if (!isSystemAdmin) {
    const member = await db.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId } },
      select: { status: true }
    });
    if (member?.status !== "ACTIVE") throw new Error("Room access denied");
  }
  return room;
}

export async function listRoomsForUser(userId: string) {
  return db.matchRoom.findMany({
    where: { members: { some: { userId, status: "ACTIVE" } }, match: { deletedAt: null } },
    include: { match: true, owner: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" }
  });
}

export async function getRoomDetails(matchId: string, userId: string, isSystemAdmin = false) {
  const room = await requireRoomAccess(matchId, userId, isSystemAdmin);
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  return db.matchRoom.findUniqueOrThrow({
    where: { id: room.id },
    include: {
      owner: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { joinedAt: "asc" } },
      presences: { where: { lastSeenAt: { gte: cutoff } }, select: { userId: true } }
    }
  });
}

export async function joinRoomByCode(code: string, userId: string) {
  const room = await db.matchRoom.findUnique({
    where: { inviteCode: code.trim().toUpperCase() },
    include: { match: { select: { id: true, deletedAt: true } } }
  });
  if (!room || room.match.deletedAt) throw new Error("Invalid room invite code");
  const existing = await db.roomMember.findUnique({ where: { roomId_userId: { roomId: room.id, userId } } });
  if (existing?.status === "REMOVED") throw new Error("You were removed from this room");
  await db.roomMember.upsert({
    where: { roomId_userId: { roomId: room.id, userId } },
    create: { roomId: room.id, userId },
    update: { status: "ACTIVE" }
  });
  await db.matchRoom.update({ where: { id: room.id }, data: { revision: { increment: 1 } } });
  return { roomId: room.id, matchId: room.match.id };
}

export async function enterRoom(matchId: string, userId: string, isSystemAdmin = false) {
  const room = await requireRoomAccess(matchId, userId, isSystemAdmin);
  const connectionToken = randomBytes(24).toString("hex");
  await db.roomPresence.upsert({
    where: { userId },
    create: { roomId: room.id, userId, connectionToken },
    update: { roomId: room.id, connectionToken, lastSeenAt: new Date() }
  });
  return { roomId: room.id, connectionToken };
}

export async function heartbeatRoom(roomId: string, userId: string, connectionToken: string) {
  const updated = await db.roomPresence.updateMany({
    where: { roomId, userId, connectionToken },
    data: { lastSeenAt: new Date() }
  });
  return updated.count === 1;
}

export async function getRoomSnapshot(matchId: string, userId: string, isSystemAdmin = false) {
  const room = await requireRoomAccess(matchId, userId, isSystemAdmin);
  const now = Date.now();
  const storedTimer = asTimer(room.timerStateJson);
  const storedStartedAt = room.timerStartedAt?.getTime() ?? null;
  const normalized = normalizeSharedTimer(storedTimer, now, storedStartedAt);
  const timerFinished = storedTimer.running && !normalized.state.running;
  if (timerFinished) {
    await db.matchRoom.update({
      where: { id: room.id },
      data: {
        timerStateJson: normalized.state as unknown as Prisma.InputJsonValue,
        timerStartedAt: null
      }
    });
  }
  const cutoff = new Date(now - ONLINE_WINDOW_MS);
  const presences = await db.roomPresence.findMany({
    where: { roomId: room.id, lastSeenAt: { gte: cutoff } },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { lastSeenAt: "desc" }
  });
  return {
    roomId: room.id,
    inviteCode: room.inviteCode,
    ownerId: room.ownerId,
    revision: room.revision,
    timer: timerFinished ? normalized.state : storedTimer,
    timerStartedAt: timerFinished ? null : storedStartedAt,
    members: presences.map((presence) => presence.user)
  };
}

export async function updateRoomTimer(matchId: string, userId: string, state: SharedTimerState, startedAtMs: number | null) {
  const room = await requireRoomAccess(matchId, userId);
  await db.matchRoom.update({
    where: { id: room.id },
    data: {
      timerStateJson: state as unknown as Prisma.InputJsonValue,
      timerStartedAt: state.running ? new Date(startedAtMs ?? Date.now()) : null,
      revision: { increment: 1 }
    }
  });
}

export async function touchRoomByMatchId(matchId: string) {
  await db.matchRoom.updateMany({ where: { matchId }, data: { revision: { increment: 1 } } });
}

export async function rotateRoomCode(matchId: string, actorId: string, isSystemAdmin = false) {
  const room = await requireRoomAccess(matchId, actorId, isSystemAdmin);
  if (!isSystemAdmin && room.ownerId !== actorId) throw new Error("Only the room owner can rotate the code");
  return db.matchRoom.update({ where: { id: room.id }, data: { inviteCode: await allocateRoomInviteCode(), revision: { increment: 1 } } });
}

export async function setRoomMemberStatus(matchId: string, targetUserId: string, actorId: string, status: "ACTIVE" | "REMOVED", isSystemAdmin = false) {
  const room = await requireRoomAccess(matchId, actorId, isSystemAdmin);
  if (!isSystemAdmin && room.ownerId !== actorId) throw new Error("Only the room owner can manage members");
  if (targetUserId === room.ownerId && status === "REMOVED") throw new Error("Transfer ownership before removing the owner");
  await db.roomMember.upsert({
    where: { roomId_userId: { roomId: room.id, userId: targetUserId } },
    create: { roomId: room.id, userId: targetUserId, status },
    update: { status }
  });
  if (status === "REMOVED") await db.roomPresence.deleteMany({ where: { roomId: room.id, userId: targetUserId } });
  await touchRoomByMatchId(matchId);
}

export async function transferRoomOwnership(matchId: string, targetUserId: string, actorId: string, isSystemAdmin = false) {
  const room = await requireRoomAccess(matchId, actorId, isSystemAdmin);
  if (!isSystemAdmin && room.ownerId !== actorId) throw new Error("Only the room owner can transfer ownership");
  const member = await db.roomMember.findUnique({ where: { roomId_userId: { roomId: room.id, userId: targetUserId } } });
  if (member?.status !== "ACTIVE") throw new Error("New owner must be an active room member");
  const presence = await db.roomPresence.findFirst({
    where: { roomId: room.id, userId: targetUserId, lastSeenAt: { gte: new Date(Date.now() - ONLINE_WINDOW_MS) } },
    select: { id: true }
  });
  if (!presence) throw new Error("New owner must currently be online in the room");
  await db.matchRoom.update({ where: { id: room.id }, data: { ownerId: targetUserId, revision: { increment: 1 } } });
}

export async function listOnlineUsers() {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const sessions = await db.session.findMany({
    where: { kind: "user", expiresAt: { gt: new Date() }, lastSeenAt: { gte: cutoff }, user: { disabledAt: null } },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { lastSeenAt: "desc" }
  });
  return Array.from(new Map(sessions.map((session) => [session.user.id, session.user])).values());
}

export async function listActiveRooms() {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  return db.matchRoom.findMany({
    where: { match: { deletedAt: null }, presences: { some: { lastSeenAt: { gte: cutoff } } } },
    include: {
      match: true,
      owner: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      presences: { where: { lastSeenAt: { gte: cutoff } }, include: { user: { select: { id: true, name: true } } } }
    },
    orderBy: { updatedAt: "desc" }
  });
}

export async function inviteUserToRoom(matchId: string, recipientId: string, invitedById: string) {
  const room = await db.matchRoom.findUnique({ where: { matchId } });
  if (!room) throw new Error("Room not found");
  const onlineCutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const online = await db.session.count({
    where: { userId: recipientId, kind: "user", expiresAt: { gt: new Date() }, lastSeenAt: { gte: onlineCutoff }, user: { disabledAt: null } }
  });
  if (!online) throw new Error("The selected user is no longer online");
  await db.roomInvitation.updateMany({
    where: { roomId: room.id, recipientId, status: "PENDING" },
    data: { status: "CANCELLED", respondedAt: new Date() }
  });
  return db.roomInvitation.create({
    data: { roomId: room.id, recipientId, invitedById, expiresAt: new Date(Date.now() + ROOM_INVITATION_TTL_MS) }
  });
}

export async function getPendingRoomInvitation(userId: string) {
  const now = new Date();
  await db.roomInvitation.updateMany({
    where: { recipientId: userId, status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED", respondedAt: now }
  });
  return db.roomInvitation.findFirst({
    where: { recipientId: userId, status: "PENDING", expiresAt: { gt: now } },
    include: { room: { include: { match: true } }, invitedBy: { select: { name: true } } },
    orderBy: { createdAt: "asc" }
  });
}

export async function respondToRoomInvitation(invitationId: string, userId: string, accept: boolean) {
  const now = new Date();
  const invitation = await db.roomInvitation.findFirst({
    where: { id: invitationId, recipientId: userId, status: "PENDING", expiresAt: { gt: now } },
    include: { room: { include: { match: { select: { id: true } } } } }
  });
  if (!invitation) throw new Error("Invitation is no longer available");
  await db.$transaction(async (tx) => {
    const claimed = await tx.roomInvitation.updateMany({
      where: { id: invitation.id, recipientId: userId, status: "PENDING", expiresAt: { gt: now } },
      data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: now }
    });
    if (claimed.count !== 1) throw new Error("Invitation is no longer available");
    if (accept) {
      await tx.roomMember.upsert({
        where: { roomId_userId: { roomId: invitation.roomId, userId } },
        create: { roomId: invitation.roomId, userId },
        update: { status: "ACTIVE" }
      });
      await tx.matchRoom.update({ where: { id: invitation.roomId }, data: { revision: { increment: 1 } } });
    }
  });
  return accept ? invitation.room.match.id : null;
}

export function prismaFormatToShared(format: PrismaDebateFormat): DebateFormat {
  return mapPrismaFormat(format);
}
