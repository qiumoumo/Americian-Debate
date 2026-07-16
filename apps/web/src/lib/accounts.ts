import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, type Prisma } from "@debate/db";
import { activeUserSessionWhere } from "./rooms.ts";

export type GlobalAccountFilter = "all" | "online" | "disabled" | "admin";

async function requireSystemAdministrator(actorId: string) {
  const actor = await db.user.findFirst({
    where: {
      id: actorId,
      isSystemAdmin: true,
      disabledAt: null,
      passwordHash: { not: null },
      memberships: { some: { workspace: { deletedAt: null } } }
    },
    include: { memberships: { where: { workspace: { deletedAt: null } }, orderBy: { createdAt: "asc" }, take: 1 } }
  });
  if (!actor) throw new Error("System administrator access is required");
  return actor;
}

async function audit(tx: Prisma.TransactionClient, actor: Awaited<ReturnType<typeof requireSystemAdministrator>>, action: string, targetId: string, meta?: object) {
  const workspaceId = actor.memberships[0]?.workspaceId;
  if (!workspaceId) throw new Error("System administrator requires an active workspace");
  await tx.auditLog.create({
    data: {
      workspaceId,
      actorUserId: actor.id,
      actorName: actor.name,
      action,
      targetType: "User",
      targetId,
      metaJson: meta ?? undefined
    }
  });
}

export async function getGlobalAccounts(actorId: string, input: { query?: string; filter?: GlobalAccountFilter }) {
  await requireSystemAdministrator(actorId);
  const now = new Date();
  const query = input.query?.trim();
  const onlineWhere = activeUserSessionWhere(now);
  const users = await db.user.findMany({
    where: {
      ...(query ? { OR: [{ name: { contains: query } }, { email: { contains: query } }] } : {}),
      ...(input.filter === "disabled" ? { disabledAt: { not: null } } : {}),
      ...(input.filter === "admin" ? { isSystemAdmin: true } : {}),
      ...(input.filter === "online" ? { sessions: { some: onlineWhere } } : {})
    },
    include: {
      memberships: { include: { workspace: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      sessions: { where: { kind: "user" }, select: { lastSeenAt: true, expiresAt: true }, orderBy: { lastSeenAt: "desc" }, take: 1 },
      _count: { select: { documents: true, matches: true, practiceSessions: true, roomMemberships: true } }
    },
    orderBy: [{ createdAt: "desc" }, { name: "asc" }]
  });
  const activeSessions = await db.session.findMany({
    where: { ...onlineWhere, userId: { in: users.map((user) => user.id) } },
    select: { userId: true },
    distinct: ["userId"]
  });
  const onlineUserIds = new Set(activeSessions.map((session) => session.userId));
  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    disabledAt: user.disabledAt,
    isSystemAdmin: user.isSystemAdmin,
    mustChangePassword: user.mustChangePassword,
    hasPassword: Boolean(user.passwordHash),
    online: onlineUserIds.has(user.id),
    lastSeenAt: user.sessions[0]?.lastSeenAt ?? null,
    memberships: user.memberships.map((membership) => ({ role: membership.role, workspaceId: membership.workspaceId, workspaceName: membership.workspace.name })),
    counts: user._count
  }));
}

export async function resetGlobalAccountPassword(actorId: string, targetId: string) {
  const actor = await requireSystemAdministrator(actorId);
  if (actorId === targetId) throw new Error("Use your own password settings to reset your own account");
  const target = await db.user.findUnique({ where: { id: targetId }, select: { id: true, email: true } });
  if (!target) throw new Error("Account not found");
  const temporaryPassword = randomBytes(12).toString("base64url");
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { passwordHash, mustChangePassword: true } });
    await tx.session.deleteMany({ where: { userId: target.id } });
    await tx.roomPresence.deleteMany({ where: { userId: target.id } });
    await audit(tx, actor, "account.password_reset", target.id, { email: target.email });
  });
  return { temporaryPassword };
}

export async function setGlobalAccountDisabled(actorId: string, targetId: string, disabled: boolean) {
  const actor = await requireSystemAdministrator(actorId);
  if (actorId === targetId) throw new Error("Cannot disable your own account");
  const target = await db.user.findUnique({ where: { id: targetId } });
  if (!target) throw new Error("Account not found");
  await db.$transaction(async (tx) => {
    if (disabled && target.isSystemAdmin) {
      const remaining = await tx.user.count({ where: { isSystemAdmin: true, disabledAt: null, passwordHash: { not: null }, id: { not: targetId }, memberships: { some: { workspace: { deletedAt: null } } } } });
      if (!remaining) throw new Error("Cannot disable the last system administrator");
    }
    await tx.user.update({ where: { id: targetId }, data: { disabledAt: disabled ? new Date() : null } });
    if (disabled) {
      await tx.session.deleteMany({ where: { userId: targetId } });
      await tx.roomPresence.deleteMany({ where: { userId: targetId } });
    }
    await audit(tx, actor, disabled ? "account.disable" : "account.enable", targetId);
  });
}

export async function setGlobalSystemAdmin(actorId: string, targetId: string, enabled: boolean) {
  const actor = await requireSystemAdministrator(actorId);
  if (actorId === targetId && !enabled) throw new Error("Cannot revoke your own system administrator access");
  const target = await db.user.findUnique({ where: { id: targetId } });
  if (!target) throw new Error("Account not found");
  await db.$transaction(async (tx) => {
    if (!enabled && target.isSystemAdmin) {
      const remaining = await tx.user.count({ where: { isSystemAdmin: true, disabledAt: null, passwordHash: { not: null }, id: { not: targetId }, memberships: { some: { workspace: { deletedAt: null } } } } });
      if (!remaining) throw new Error("Cannot revoke the last system administrator");
    }
    await tx.user.update({ where: { id: targetId }, data: { isSystemAdmin: enabled } });
    await audit(tx, actor, enabled ? "system_admin.grant" : "system_admin.revoke", targetId);
  });
}

export async function deleteGlobalAccount(actorId: string, targetId: string, confirmationEmail: string) {
  const actor = await requireSystemAdministrator(actorId);
  if (actorId === targetId) throw new Error("Cannot delete your own account");
  const target = await db.user.findUnique({
    where: { id: targetId },
    include: { memberships: { select: { workspaceId: true } } }
  });
  if (!target) throw new Error("Account not found");
  if (confirmationEmail.trim().toLowerCase() !== target.email.toLowerCase()) throw new Error("Confirmation email does not match");
  const workspaceIds = target.memberships.map((membership) => membership.workspaceId);
  await db.$transaction(async (tx) => {
    if (target.isSystemAdmin) {
      const remaining = await tx.user.count({ where: { isSystemAdmin: true, disabledAt: null, passwordHash: { not: null }, id: { not: targetId }, memberships: { some: { workspace: { deletedAt: null } } } } });
      if (!remaining) throw new Error("Cannot delete the last system administrator");
    }
    const transferredRooms = await tx.matchRoom.findMany({ where: { ownerId: targetId, match: { userId: { not: targetId } } }, include: { match: { select: { userId: true } } } });
    for (const room of transferredRooms) {
      await tx.roomMember.upsert({ where: { roomId_userId: { roomId: room.id, userId: room.match.userId } }, create: { roomId: room.id, userId: room.match.userId }, update: { status: "ACTIVE" } });
      await tx.matchRoom.update({ where: { id: room.id }, data: { ownerId: room.match.userId } });
    }
    await tx.match.deleteMany({ where: { userId: targetId } });
    await tx.document.deleteMany({ where: { ownerId: targetId } });
    await audit(tx, actor, "account.delete", targetId, { email: target.email });
    await tx.user.delete({ where: { id: targetId } });
    for (const workspaceId of workspaceIds) {
      if (await tx.membership.count({ where: { workspaceId } }) === 0) {
        await tx.workspace.delete({ where: { id: workspaceId } });
      }
    }
  });
}
