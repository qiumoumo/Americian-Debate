"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@debate/db";
import { getAdminSession, requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

/** Workspaces the current admin user owns (OWNER membership, not deleted). */
async function ownedWorkspaceIds(userId: string) {
  const memberships = await db.membership.findMany({
    where: { userId, role: "OWNER", workspace: { deletedAt: null } },
    select: { workspaceId: true }
  });
  return memberships.map((m) => m.workspaceId);
}

export async function createWorkspace(formData: FormData) {
  const session = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect("/admin/workspaces?error=invalid");
  }

  const workspace = await db.$transaction(async (tx) => {
    const created = await tx.workspace.create({ data: { name } });
    // The creating admin becomes OWNER of the new workspace.
    await tx.membership.create({ data: { userId: session.user.id, workspaceId: created.id, role: "OWNER" } });
    return created;
  });

  await recordAudit({
    workspaceId: workspace.id,
    actorUserId: session.user.id,
    actorName: session.user.name,
    action: "workspace.create",
    targetType: "workspace",
    targetId: workspace.id,
    meta: { name }
  });

  revalidatePath("/admin/workspaces");
}

export async function renameWorkspace(formData: FormData) {
  const session = await requireAdmin();
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect("/admin/workspaces?error=invalid");
  }

  const owned = await ownedWorkspaceIds(session.user.id);
  if (!owned.includes(workspaceId)) {
    redirect("/admin/workspaces?error=forbidden");
  }

  await db.workspace.update({ where: { id: workspaceId }, data: { name } });
  await recordAudit({
    workspaceId,
    actorUserId: session.user.id,
    actorName: session.user.name,
    action: "workspace.rename",
    targetType: "workspace",
    targetId: workspaceId,
    meta: { name }
  });
  revalidatePath("/admin/workspaces");
}

export async function archiveWorkspace(formData: FormData) {
  const session = await requireAdmin();
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();

  const owned = await ownedWorkspaceIds(session.user.id);
  if (!owned.includes(workspaceId)) {
    redirect("/admin/workspaces?error=forbidden");
  }
  if (owned.length <= 1) {
    redirect("/admin/workspaces?error=last_workspace");
  }
  if (workspaceId === session.workspace.id) {
    redirect("/admin/workspaces?error=current");
  }

  await db.workspace.update({ where: { id: workspaceId }, data: { deletedAt: new Date() } });
  await recordAudit({
    workspaceId,
    actorUserId: session.user.id,
    actorName: session.user.name,
    action: "workspace.archive",
    targetType: "workspace",
    targetId: workspaceId
  });
  revalidatePath("/admin/workspaces");
}

/** Switches which workspace the admin session points at (updates the admin Session row). */
export async function switchWorkspace(formData: FormData) {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();

  const owned = await ownedWorkspaceIds(session.user.id);
  const coach = await db.membership.findFirst({
    where: { userId: session.user.id, workspaceId, role: { in: ["OWNER", "COACH"] }, workspace: { deletedAt: null } }
  });
  if (!owned.includes(workspaceId) && !coach) {
    redirect("/admin/workspaces?error=forbidden");
  }

  // Point every admin session for this user at the chosen workspace.
  await db.session.updateMany({
    where: { userId: session.user.id, kind: "admin" },
    data: { workspaceId }
  });

  revalidatePath("/admin", "layout");
  redirect("/admin/workspaces?switched=1");
}
