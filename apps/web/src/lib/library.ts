import { db, type Role } from "@debate/db";

export interface LibraryActor {
  userId: string;
  workspaceId: string;
  role: Role;
}

export function canCreateLibraryRound(actor: LibraryActor) {
  return actor.role !== "VIEWER";
}

export function canManageLibraryRound(actor: LibraryActor, createdByUserId: string | null) {
  return actor.userId === createdByUserId || actor.role === "OWNER" || actor.role === "COACH";
}

export async function requireLibraryRoundAccess(
  actor: LibraryActor,
  roundId: string,
  intent: "view" | "edit" | "delete"
) {
  const round = await db.libraryRound.findFirst({
    where: { id: roundId, workspaceId: actor.workspaceId, deletedAt: null },
    select: { id: true, createdByUserId: true }
  });
  if (!round) throw new Error("素材不存在或不属于当前工作区");
  if (intent !== "view" && !canManageLibraryRound(actor, round.createdByUserId)) {
    throw new Error("只有发布者或工作区管理员可以修改这份素材");
  }
  return round;
}

export function libraryActorFromSession(session: {
  user: { id: string };
  workspace: { id: string };
  role: Role;
}): LibraryActor {
  return { userId: session.user.id, workspaceId: session.workspace.id, role: session.role };
}
