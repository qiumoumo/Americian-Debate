"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, type Role } from "@debate/db";
import { requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

const allowedRoles: Role[] = ["OWNER", "COACH", "DEBATER", "VIEWER"];

function parseRole(value: FormDataEntryValue | null): Role {
  const role = String(value ?? "").trim();
  if (!allowedRoles.includes(role as Role)) {
    throw new Error("Invalid role.");
  }
  return role as Role;
}

function normalizeEmail(value: FormDataEntryValue | null) {
  return String(value ?? "").trim().toLowerCase();
}

/** requireAdmin already enforces OWNER/COACH; this narrows to OWNER for destructive ops. */
async function requireOwner() {
  const session = await requireAdmin();
  if (session.role !== "OWNER") {
    throw new Error("仅 OWNER 可执行该操作。");
  }
  return session;
}

async function assertNotLastOwner(workspaceId: string, membership: { role: Role }) {
  if (membership.role !== "OWNER") return;
  const ownerCount = await db.membership.count({ where: { workspaceId, role: "OWNER" } });
  if (ownerCount <= 1) {
    throw new Error("不能移除或禁用工作区的最后一个 OWNER。");
  }
}

export async function updateMemberRole(formData: FormData) {
  const session = await requireOwner();

  const membershipId = String(formData.get("membershipId") ?? "").trim();
  if (!membershipId) {
    throw new Error("membershipId is required");
  }
  const role = parseRole(formData.get("role"));

  const membership = await db.membership.findFirst({
    where: { id: membershipId, workspaceId: session.workspace.id }
  });
  if (!membership) {
    throw new Error("Membership not found.");
  }

  if (membership.role === "OWNER" && role !== "OWNER") {
    await assertNotLastOwner(session.workspace.id, membership);
  }

  await db.membership.update({ where: { id: membership.id }, data: { role } });
  await recordAudit({
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    actorName: session.user.name,
    action: "member.role_update",
    targetType: "membership",
    targetId: membership.id,
    meta: { from: membership.role, to: role }
  });
  revalidatePath("/admin/members");
}

export async function inviteMember(formData: FormData) {
  const session = await requireAdmin();
  const email = normalizeEmail(formData.get("email"));
  const role = parseRole(formData.get("role"));

  if (!email || !email.includes("@")) {
    redirect("/admin/members?error=invalid_email");
  }
  // COACH may only invite non-privileged roles.
  if (session.role !== "OWNER" && (role === "OWNER" || role === "COACH")) {
    redirect("/admin/members?error=forbidden_role");
  }

  const existing = await db.user.findUnique({ where: { email }, include: { memberships: true } });
  if (existing?.memberships.some((membership) => membership.workspaceId === session.workspace.id)) {
    redirect("/admin/members?error=already_member");
  }

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

  await db.invitation.create({
    data: {
      email,
      role,
      token,
      workspaceId: session.workspace.id,
      invitedById: session.user.id,
      expiresAt
    }
  });

  await recordAudit({
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    actorName: session.user.name,
    action: "member.invite",
    targetType: "invitation",
    meta: { email, role }
  });

  revalidatePath("/admin/members");
  redirect(`/admin/members?invited=${encodeURIComponent(email)}&token=${token}`);
}

export async function revokeInvitation(formData: FormData) {
  const session = await requireAdmin();
  const invitationId = String(formData.get("invitationId") ?? "").trim();

  await db.invitation.deleteMany({
    where: { id: invitationId, workspaceId: session.workspace.id, acceptedAt: null }
  });
  revalidatePath("/admin/members");
}

export async function removeMember(formData: FormData) {
  const session = await requireOwner();
  const membershipId = String(formData.get("membershipId") ?? "").trim();

  const membership = await db.membership.findFirst({
    where: { id: membershipId, workspaceId: session.workspace.id }
  });
  if (!membership) {
    throw new Error("Membership not found.");
  }
  if (membership.userId === session.user.id) {
    redirect("/admin/members?error=self");
  }
  await assertNotLastOwner(session.workspace.id, membership);

  // Drop the membership and any sessions scoped to this workspace; the user
  // account itself is kept (they may belong to other workspaces).
  await db.session.deleteMany({ where: { userId: membership.userId, workspaceId: session.workspace.id } });
  await db.membership.delete({ where: { id: membership.id } });

  await recordAudit({
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    actorName: session.user.name,
    action: "member.remove",
    targetType: "membership",
    targetId: membership.id,
    meta: { role: membership.role }
  });

  revalidatePath("/admin/members");
}
