"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { readAIConfigForm, saveWorkspaceAIConfig } from "@/lib/ai-config";

export async function updateWorkspaceAIConfig(formData: FormData) {
  const session = await requireAdmin();
  if (session.role !== "OWNER") {
    throw new Error("仅 OWNER 可修改 workspace AI 配置。");
  }

  const input = readAIConfigForm(formData);
  await saveWorkspaceAIConfig({
    ...input,
    workspaceId: session.workspace.id,
    updatedByUserId: session.user.id
  });

  await recordAudit({
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    actorName: session.user.name,
    action: "ai.workspace_config_update",
    targetType: "workspaceAIConfig",
    meta: { providerId: input.providerId, enabled: input.enabled }
  });

  revalidatePath("/admin/ai");
}
