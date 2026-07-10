"use server";

import { revalidatePath } from "next/cache";
import { db } from "@debate/db";
import { requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { saveSystemSettings, type WorkspaceSystemSettings } from "@/lib/settings";

export async function createAnnouncement(formData: FormData) {
  const session = await requireAdmin();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const published = String(formData.get("published") ?? "") === "true";
  if (!title) return;

  const announcement = await db.announcement.create({
    data: { workspaceId: session.workspace.id, title, body, published, createdByUserId: session.user.id }
  });
  await recordAudit({
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    actorName: session.user.name,
    action: "announcement.create",
    targetType: "announcement",
    targetId: announcement.id,
    meta: { title, published }
  });
  revalidatePath("/admin/settings");
}

export async function toggleAnnouncement(formData: FormData) {
  const session = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const publish = String(formData.get("publish") ?? "") === "true";

  await db.announcement.updateMany({
    where: { id, workspaceId: session.workspace.id },
    data: { published: publish }
  });
  await recordAudit({
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    actorName: session.user.name,
    action: "announcement.update",
    targetType: "announcement",
    targetId: id,
    meta: { published: publish }
  });
  revalidatePath("/admin/settings");
}

export async function deleteAnnouncement(formData: FormData) {
  const session = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();

  await db.announcement.deleteMany({ where: { id, workspaceId: session.workspace.id } });
  await recordAudit({
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    actorName: session.user.name,
    action: "announcement.delete",
    targetType: "announcement",
    targetId: id
  });
  revalidatePath("/admin/settings");
}

export async function updateSystemSettings(formData: FormData) {
  const session = await requireAdmin();
  if (session.role !== "OWNER") {
    throw new Error("仅 OWNER 可修改系统设置。");
  }

  const minLen = Number(formData.get("minPasswordLength") ?? 8);
  const settings: WorkspaceSystemSettings = {
    registrationOpen: String(formData.get("registrationOpen") ?? "") === "true",
    defaultFormat: String(formData.get("defaultFormat") ?? "PF").trim() || "PF",
    minPasswordLength: Number.isFinite(minLen) ? Math.min(64, Math.max(6, Math.round(minLen))) : 8
  };

  await saveSystemSettings(session.workspace.id, settings);
  await recordAudit({
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    actorName: session.user.name,
    action: "settings.update",
    targetType: "systemSetting",
    meta: { ...settings }
  });
  revalidatePath("/admin/settings");
}
