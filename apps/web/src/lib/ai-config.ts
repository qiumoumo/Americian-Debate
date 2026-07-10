import { db } from "@debate/db";
import {
  type AIProvider,
  AI_PROVIDER_CHOICE_IDS,
  createAIProviderFromConfig,
  createAIProviderFromEnv,
  getConfiguredAIModel,
  resolveConfigModel
} from "@debate/ai";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export type AISource = "personal" | "workspace" | "env";

/** 用户在设置里选择的 AI 来源。auto = 按默认优先级。 */
export type AIPreferredSource = "auto" | "personal" | "workspace" | "env";

export const AI_PREFERRED_SOURCE_IDS: AIPreferredSource[] = ["auto", "personal", "workspace", "env"];

export function parsePreferredSource(value: string | null | undefined): AIPreferredSource {
  return AI_PREFERRED_SOURCE_IDS.includes(String(value) as AIPreferredSource)
    ? (String(value) as AIPreferredSource)
    : "auto";
}

export interface ResolvedAI {
  provider: AIProvider;
  providerId: string;
  model: string;
  source: AISource;
}

export interface AIConfigView {
  providerId: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
  hasKey: boolean;
  preferredSource: AIPreferredSource;
}

export interface AIConfigInput {
  providerId: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  clearKey?: boolean;
}

export function parseProviderId(value: string | null | undefined): string {
  return AI_PROVIDER_CHOICE_IDS.includes(String(value)) ? String(value) : "mock";
}

/** Parses the shared AI-config form (used by both admin and user settings). */
export function readAIConfigForm(formData: FormData): AIConfigInput {
  return {
    providerId: parseProviderId(String(formData.get("providerId") ?? "")),
    model: String(formData.get("model") ?? "").trim(),
    baseUrl: String(formData.get("baseUrl") ?? "").trim(),
    apiKey: String(formData.get("apiKey") ?? "").trim(),
    enabled: String(formData.get("enabled") ?? "") === "true",
    clearKey: String(formData.get("clearKey") ?? "") === "true"
  };
}

interface StoredConfig {
  providerId: string;
  model: string;
  baseUrl: string | null;
  apiKeyEnc: string | null;
}

function buildProvider(record: StoredConfig, source: AISource): ResolvedAI {
  const providerId = parseProviderId(record.providerId);
  const apiKey = record.apiKeyEnc ? decryptSecret(record.apiKeyEnc) : undefined;
  const model = resolveConfigModel(providerId, record.model);
  const provider = createAIProviderFromConfig({
    providerId,
    apiKey,
    baseURL: record.baseUrl ?? undefined,
    model
  });
  return { provider, providerId, model, source };
}

/**
 * Resolves the effective AI provider for a request.
 *
 * The user may pin a preferred source in settings (`preferredSource`):
 *   - "personal"  → use the user's private config (fall back if not usable)
 *   - "workspace" → use the workspace/admin config (fall back to env if not usable)
 *   - "env"       → use the server env default
 *   - "auto"      → default precedence: personal → workspace → env
 * Any pinned-but-unavailable source falls back down the default chain, so a
 * request never fails just because the chosen source isn't configured.
 */
export async function resolveAIProvider({ userId, workspaceId }: { userId: string; workspaceId: string }): Promise<ResolvedAI> {
  const personal = await db.userAIConfig.findUnique({ where: { userId } });
  const preferred = parsePreferredSource(personal?.preferredSource);

  const resolveFromEnv = (): ResolvedAI => {
    const provider = createAIProviderFromEnv();
    return { provider, providerId: provider.id, model: getConfiguredAIModel(provider.id), source: "env" };
  };
  const loadWorkspace = () => db.workspaceAIConfig.findUnique({ where: { workspaceId } });

  // 显式选择服务器默认。
  if (preferred === "env") {
    return resolveFromEnv();
  }

  // 显式选择工作区共用；不可用时回退到服务器默认。
  if (preferred === "workspace") {
    const workspace = await loadWorkspace();
    if (workspace?.enabled) {
      return buildProvider(workspace, "workspace");
    }
    return resolveFromEnv();
  }

  // "personal" 与 "auto" 都优先尝试个人私有；不可用时按 workspace → env 回退。
  if (personal?.enabled) {
    return buildProvider(personal, "personal");
  }
  const workspace = await loadWorkspace();
  if (workspace?.enabled) {
    return buildProvider(workspace, "workspace");
  }
  return resolveFromEnv();
}

function toView(record: StoredConfig & { enabled: boolean; preferredSource?: string | null }): AIConfigView {
  return {
    providerId: parseProviderId(record.providerId),
    model: record.model,
    baseUrl: record.baseUrl ?? "",
    enabled: record.enabled,
    hasKey: Boolean(record.apiKeyEnc),
    preferredSource: parsePreferredSource(record.preferredSource)
  };
}

/** Workspace AI config for the admin UI — never returns the decrypted key. */
export async function getWorkspaceAIConfigView(workspaceId: string): Promise<AIConfigView | null> {
  const record = await db.workspaceAIConfig.findUnique({ where: { workspaceId } });
  return record ? toView(record) : null;
}

/** The signed-in user's private AI config — never returns the decrypted key. */
export async function getUserAIConfigView(userId: string): Promise<AIConfigView | null> {
  const record = await db.userAIConfig.findUnique({ where: { userId } });
  return record ? toView(record) : null;
}

function resolveApiKeyEnc(input: AIConfigInput, existing: string | null): string | null {
  if (input.clearKey) return null;
  if (input.apiKey) return encryptSecret(input.apiKey);
  return existing; // keep the existing key when the field is left blank
}

export async function saveWorkspaceAIConfig(input: AIConfigInput & { workspaceId: string; updatedByUserId: string }) {
  const existing = await db.workspaceAIConfig.findUnique({ where: { workspaceId: input.workspaceId } });
  const apiKeyEnc = resolveApiKeyEnc(input, existing?.apiKeyEnc ?? null);
  const base = {
    providerId: input.providerId,
    model: input.model,
    baseUrl: input.baseUrl || null,
    enabled: input.enabled,
    updatedByUserId: input.updatedByUserId,
    apiKeyEnc
  };
  await db.workspaceAIConfig.upsert({
    where: { workspaceId: input.workspaceId },
    create: { workspaceId: input.workspaceId, ...base },
    update: base
  });
}

export async function saveUserAIConfig(input: AIConfigInput & { userId: string }) {
  const existing = await db.userAIConfig.findUnique({ where: { userId: input.userId } });
  const apiKeyEnc = resolveApiKeyEnc(input, existing?.apiKeyEnc ?? null);
  const base = {
    providerId: input.providerId,
    model: input.model,
    baseUrl: input.baseUrl || null,
    enabled: input.enabled,
    apiKeyEnc
  };
  await db.userAIConfig.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId, ...base },
    update: base
  });
}

/** 只更新用户选择的 AI 来源；其它私有 AI 字段保持不变（无记录时用默认值建行）。 */
export async function saveUserAIPreference(userId: string, preferredSource: AIPreferredSource) {
  await db.userAIConfig.upsert({
    where: { userId },
    create: { userId, preferredSource },
    update: { preferredSource }
  });
}
