"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  type AIConfigActionState,
  deletePersonalAIConfig,
  readAIConfigForm,
  savePersonalAIConfig,
  saveUserAISelection,
  toActionError
} from "@/lib/ai-config";

export async function savePersonalAIConfigAction(_state: AIConfigActionState, formData: FormData): Promise<AIConfigActionState> {
  const session = await requireUser();
  try {
    const input = readAIConfigForm(formData);
    await savePersonalAIConfig({ ...input, userId: session.user.id });
    revalidatePath("/app/settings");
    return { ok: true, message: "私有 AI 配置已保存。" };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deletePersonalAIConfigAction(_state: AIConfigActionState, formData: FormData): Promise<AIConfigActionState> {
  const session = await requireUser();
  try {
    await deletePersonalAIConfig(String(formData.get("configId") ?? ""), session.user.id);
    revalidatePath("/app/settings");
    return { ok: true, message: "私有 AI 配置已删除。" };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateUserAISelectionAction(_state: AIConfigActionState, formData: FormData): Promise<AIConfigActionState> {
  const session = await requireUser();
  try {
    const selection = String(formData.get("selection") ?? "AUTO");
    if (selection.startsWith("CONFIG:")) {
      await saveUserAISelection(session.user.id, { mode: "CONFIG", configId: selection.slice("CONFIG:".length) });
    } else {
      await saveUserAISelection(session.user.id, { mode: selection === "ENV" ? "ENV" : "AUTO" });
    }
    revalidatePath("/app/settings");
    return { ok: true, message: "AI 选择已更新。" };
  } catch (error) {
    return toActionError(error);
  }
}
