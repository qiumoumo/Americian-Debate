"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  type AIConfigActionState,
  type AIEndpointActionState,
  deletePersonalAIConfig,
  discoverModelsForConfig,
  readAIConfigForm,
  savePersonalAIConfig,
  saveUserAISelection,
  testConnectionForConfig,
  toActionError
} from "@/lib/ai-config";

export async function fetchPersonalAIModelsAction(formData: FormData): Promise<AIEndpointActionState> {
  const session = await requireUser();
  try {
    const input = readAIConfigForm(formData);
    const result = await discoverModelsForConfig(input, { scope: "PERSONAL", userId: session.user.id });
    const adjusted = Boolean(input.baseUrl || input.providerId === "openai-compatible" || input.providerId === "openclaw")
      && input.baseUrl.replace(/\/+$/, "") !== result.baseUrl.replace(/\/+$/, "");
    return {
      ok: true,
      message: `已获取 ${result.models.length} 个模型。${adjusted ? "已找到可用的 API 地址；保存修改前请重新输入 API Key。" : ""}`,
      models: result.models,
      baseUrl: result.baseUrl,
      latencyMs: result.latencyMs
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function testPersonalAIConnectionAction(formData: FormData): Promise<AIEndpointActionState> {
  const session = await requireUser();
  try {
    const input = readAIConfigForm(formData);
    const result = await testConnectionForConfig(input, { scope: "PERSONAL", userId: session.user.id });
    const adjusted = Boolean(input.baseUrl || input.providerId === "openai-compatible" || input.providerId === "openclaw")
      && input.baseUrl.replace(/\/+$/, "") !== result.baseUrl.replace(/\/+$/, "");
    return {
      ok: true,
      message: `连接成功，服务端响应 ${result.latencyMs} ms。${adjusted ? "已找到可用的 API 地址；保存修改前请重新输入 API Key。" : ""}`,
      baseUrl: result.baseUrl,
      latencyMs: result.latencyMs
    };
  } catch (error) {
    return toActionError(error);
  }
}

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
