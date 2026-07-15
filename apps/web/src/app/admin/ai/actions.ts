"use server";

import { revalidatePath } from "next/cache";
import { requireSystemAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  type AIConfigActionState,
  deleteGlobalAIConfig,
  readAIConfigForm,
  saveGlobalAIConfig,
  setDefaultGlobalAIConfig,
  toActionError
} from "@/lib/ai-config";

export async function saveGlobalAIConfigAction(_state: AIConfigActionState, formData: FormData): Promise<AIConfigActionState> {
  const session = await requireSystemAdmin();
  try {
    const input = readAIConfigForm(formData);
    const saved = await saveGlobalAIConfig({ ...input, updatedByUserId: session.user.id });
    await recordAudit({
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      actorName: session.user.name,
      action: input.id ? "ai.global_config_update" : "ai.global_config_create",
      targetType: "AIConfig",
      targetId: saved.id,
      meta: { name: saved.name, providerId: saved.providerId, enabled: saved.enabled }
    });
    revalidatePath("/admin/ai");
    revalidatePath("/app/settings");
    return { ok: true, message: "全局 AI 配置已保存。" };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setDefaultGlobalAIConfigAction(_state: AIConfigActionState, formData: FormData): Promise<AIConfigActionState> {
  await requireSystemAdmin();
  try {
    await setDefaultGlobalAIConfig(String(formData.get("configId") ?? ""));
    revalidatePath("/admin/ai");
    revalidatePath("/app/settings");
    return { ok: true, message: "已设为全局默认。" };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteGlobalAIConfigAction(_state: AIConfigActionState, formData: FormData): Promise<AIConfigActionState> {
  const session = await requireSystemAdmin();
  try {
    const configId = String(formData.get("configId") ?? "");
    await deleteGlobalAIConfig(configId);
    await recordAudit({
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      actorName: session.user.name,
      action: "ai.global_config_delete",
      targetType: "AIConfig",
      targetId: configId
    });
    revalidatePath("/admin/ai");
    revalidatePath("/app/settings");
    return { ok: true, message: "全局 AI 配置已删除。" };
  } catch (error) {
    return toActionError(error);
  }
}
