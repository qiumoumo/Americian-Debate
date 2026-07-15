import { db, type AIConfig, type AIConfigScope, type AISelectionMode, type Prisma } from "@debate/db";
import {
  type AIProvider,
  AI_PROVIDER_CHOICE_IDS,
  createAIProviderFromConfig,
  createAIProviderFromEnv,
  getConfiguredAIModel,
  resolveConfigModel
} from "@debate/ai";
import { decryptSecret, encryptSecret } from "./crypto.ts";

export type AISource = "personal" | "global" | "env";

export interface ResolvedAI {
  provider: AIProvider;
  providerId: string;
  model: string;
  source: AISource;
  configId: string | null;
  configName: string | null;
}

export interface AIConfigView {
  id: string;
  name: string;
  scope: AIConfigScope;
  providerId: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
  isDefault: boolean;
  hasKey: boolean;
  updatedAt: Date;
}

export interface AIConfigInput {
  id?: string;
  name: string;
  providerId: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  clearKey?: boolean;
}

export interface AIConfigActionState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
}

export class AIConfigValidationError extends Error {
  fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "AIConfigValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export function parseProviderId(value: string | null | undefined): string {
  return AI_PROVIDER_CHOICE_IDS.includes(String(value)) ? String(value) : "mock";
}

export function parseSelectionMode(value: string | null | undefined): AISelectionMode {
  return value === "CONFIG" || value === "ENV" ? value : "AUTO";
}

export function readAIConfigForm(formData: FormData): AIConfigInput {
  const id = String(formData.get("id") ?? "").trim();
  return {
    id: id || undefined,
    name: String(formData.get("name") ?? "").trim(),
    providerId: parseProviderId(String(formData.get("providerId") ?? "")),
    model: String(formData.get("model") ?? "").trim(),
    baseUrl: String(formData.get("baseUrl") ?? "").trim(),
    apiKey: String(formData.get("apiKey") ?? "").trim(),
    enabled: String(formData.get("enabled") ?? "") === "true",
    clearKey: String(formData.get("clearKey") ?? "") === "true"
  };
}

function toView(record: AIConfig): AIConfigView {
  return {
    id: record.id,
    name: record.name,
    scope: record.scope,
    providerId: parseProviderId(record.providerId),
    model: resolveConfigModel(record.providerId, record.model),
    baseUrl: record.baseUrl ?? "",
    enabled: record.enabled,
    isDefault: record.isDefault,
    hasKey: Boolean(record.apiKeyEnc),
    updatedAt: record.updatedAt
  };
}

function resolveApiKeyEnc(input: AIConfigInput, existing: string | null): string | null {
  if (input.clearKey) return null;
  if (input.apiKey) return encryptSecret(input.apiKey);
  return existing;
}

function validateInput(input: AIConfigInput, existingKey: string | null) {
  const fieldErrors: Record<string, string> = {};
  if (!input.name) fieldErrors.name = "请输入配置名称。";

  const providerId = parseProviderId(input.providerId);
  if (input.baseUrl) {
    try {
      const url = new URL(input.baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
    } catch {
      fieldErrors.baseUrl = "Base URL 必须是有效的 HTTP(S) 地址。";
    }
  }

  if (input.enabled && providerId !== "mock") {
    const hasKey = Boolean(input.apiKey || (!input.clearKey && existingKey));
    if (!hasKey) fieldErrors.apiKey = "启用此 provider 前必须配置 API Key。";
    if (!resolveConfigModel(providerId, input.model)) fieldErrors.model = "启用此 provider 前必须配置模型名称。";
    if ((providerId === "openai-compatible" || providerId === "openclaw") && !input.baseUrl) {
      fieldErrors.baseUrl = "自定义兼容端点必须填写 Base URL。";
    }
    if ((providerId === "openai-compatible" || providerId === "openclaw") && !input.model) {
      fieldErrors.model = "自定义兼容端点必须填写模型名称。";
    }
  }

  if (Object.keys(fieldErrors).length) {
    throw new AIConfigValidationError(Object.values(fieldErrors)[0] ?? "请修正 AI 配置后再保存。", fieldErrors);
  }
}

type TransactionClient = Prisma.TransactionClient;

async function ensureGlobalDefault(tx: TransactionClient) {
  const candidate = await tx.aIConfig.findFirst({
    where: { scope: "GLOBAL", enabled: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { id: "asc" }]
  });
  if (!candidate) {
    await tx.aIConfig.updateMany({ where: { scope: "GLOBAL", isDefault: true }, data: { isDefault: false } });
    return null;
  }
  await tx.aIConfig.updateMany({
    where: { scope: "GLOBAL", isDefault: true, id: { not: candidate.id } },
    data: { isDefault: false }
  });
  if (!candidate.isDefault) {
    return tx.aIConfig.update({ where: { id: candidate.id }, data: { isDefault: true } });
  }
  return candidate;
}

export async function getGlobalAIConfigs(options: { includeDisabled?: boolean } = {}) {
  const records = await db.aIConfig.findMany({
    where: { scope: "GLOBAL", ...(options.includeDisabled ? {} : { enabled: true }) },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { name: "asc" }]
  });
  return records.map(toView);
}

export async function getUserAIConfigs(userId: string) {
  const records = await db.aIConfig.findMany({
    where: { scope: "PERSONAL", ownerUserId: userId },
    orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }, { name: "asc" }]
  });
  return records.map(toView);
}

export async function saveGlobalAIConfig(input: AIConfigInput & { updatedByUserId: string }) {
  return db.$transaction(async (tx) => {
    const existing = input.id
      ? await tx.aIConfig.findFirst({ where: { id: input.id, scope: "GLOBAL" } })
      : null;
    if (input.id && !existing) throw new AIConfigValidationError("Global AI configuration not found.");
    validateInput(input, existing?.apiKeyEnc ?? null);
    const apiKeyEnc = resolveApiKeyEnc(input, existing?.apiKeyEnc ?? null);
    const data = {
      name: input.name,
      providerId: parseProviderId(input.providerId),
      model: input.model,
      baseUrl: input.baseUrl || null,
      apiKeyEnc,
      enabled: input.enabled,
      updatedByUserId: input.updatedByUserId
    };
    const saved = existing
      ? await tx.aIConfig.update({ where: { id: existing.id }, data })
      : await tx.aIConfig.create({ data: { ...data, scope: "GLOBAL" } });

    if (!saved.enabled && saved.isDefault) {
      await tx.aIConfig.update({ where: { id: saved.id }, data: { isDefault: false } });
    }
    if (!saved.enabled) {
      await tx.userAISelection.updateMany({
        where: { configId: saved.id },
        data: { mode: "AUTO", configId: null }
      });
    }
    await ensureGlobalDefault(tx);
    return toView(await tx.aIConfig.findUniqueOrThrow({ where: { id: saved.id } }));
  });
}

export async function savePersonalAIConfig(input: AIConfigInput & { userId: string }) {
  return db.$transaction(async (tx) => {
    const existing = input.id
      ? await tx.aIConfig.findFirst({ where: { id: input.id, scope: "PERSONAL", ownerUserId: input.userId } })
      : null;
    if (input.id && !existing) throw new AIConfigValidationError("Personal AI configuration not found.");
    validateInput(input, existing?.apiKeyEnc ?? null);
    const apiKeyEnc = resolveApiKeyEnc(input, existing?.apiKeyEnc ?? null);
    const data = {
      name: input.name,
      providerId: parseProviderId(input.providerId),
      model: input.model,
      baseUrl: input.baseUrl || null,
      apiKeyEnc,
      enabled: input.enabled,
      isDefault: false
    };
    const saved = existing
      ? await tx.aIConfig.update({ where: { id: existing.id }, data })
      : await tx.aIConfig.create({ data: { ...data, scope: "PERSONAL", ownerUserId: input.userId } });
    if (!saved.enabled) {
      await tx.userAISelection.updateMany({
        where: { userId: input.userId, configId: saved.id },
        data: { mode: "AUTO", configId: null }
      });
    }
    return toView(saved);
  });
}

export async function setDefaultGlobalAIConfig(id: string) {
  await db.$transaction(async (tx) => {
    const config = await tx.aIConfig.findFirst({ where: { id, scope: "GLOBAL", enabled: true } });
    if (!config) throw new AIConfigValidationError("只能将已启用的全局 AI 设为默认。", { configId: "配置不可用。" });
    await tx.aIConfig.updateMany({ where: { scope: "GLOBAL", isDefault: true }, data: { isDefault: false } });
    await tx.aIConfig.update({ where: { id }, data: { isDefault: true } });
  });
}

export async function deleteGlobalAIConfig(id: string) {
  await db.$transaction(async (tx) => {
    const config = await tx.aIConfig.findFirst({ where: { id, scope: "GLOBAL" } });
    if (!config) throw new AIConfigValidationError("Global AI configuration not found.");
    await tx.userAISelection.updateMany({ where: { configId: id }, data: { mode: "AUTO", configId: null } });
    await tx.aIConfig.delete({ where: { id } });
    await ensureGlobalDefault(tx);
  });
}

export async function deletePersonalAIConfig(id: string, userId: string) {
  await db.$transaction(async (tx) => {
    const config = await tx.aIConfig.findFirst({ where: { id, scope: "PERSONAL", ownerUserId: userId } });
    if (!config) throw new AIConfigValidationError("Personal AI configuration not found.");
    await tx.userAISelection.updateMany({ where: { userId, configId: id }, data: { mode: "AUTO", configId: null } });
    await tx.aIConfig.delete({ where: { id } });
  });
}

export async function getUserAISelection(userId: string) {
  const selection = await db.userAISelection.findUnique({ where: { userId } });
  return { mode: selection?.mode ?? "AUTO", configId: selection?.configId ?? null };
}

export async function saveUserAISelection(userId: string, input: { mode: AISelectionMode; configId?: string | null }) {
  const mode = parseSelectionMode(input.mode);
  let configId: string | null = null;
  if (mode === "CONFIG") {
    const config = input.configId
      ? await db.aIConfig.findFirst({
          where: {
            id: input.configId,
            enabled: true,
            OR: [{ scope: "GLOBAL" }, { scope: "PERSONAL", ownerUserId: userId }]
          }
        })
      : null;
    if (!config) throw new AIConfigValidationError("所选 AI 配置不可用。", { configId: "请重新选择。" });
    configId = config.id;
  }
  await db.userAISelection.upsert({
    where: { userId },
    create: { userId, mode, configId },
    update: { mode, configId }
  });
}

function buildProvider(record: AIConfig, source: Exclude<AISource, "env">): ResolvedAI {
  const providerId = parseProviderId(record.providerId);
  const apiKey = record.apiKeyEnc ? decryptSecret(record.apiKeyEnc) : undefined;
  const model = resolveConfigModel(providerId, record.model);
  const provider = createAIProviderFromConfig({
    providerId,
    apiKey,
    baseURL: record.baseUrl ?? undefined,
    model
  });
  return { provider, providerId, model, source, configId: record.id, configName: record.name };
}

function resolveFromEnv(): ResolvedAI {
  const provider = createAIProviderFromEnv();
  return {
    provider,
    providerId: provider.id,
    model: getConfiguredAIModel(provider.id),
    source: "env",
    configId: null,
    configName: null
  };
}

export async function resolveAIProvider({ userId, workspaceId }: { userId: string; workspaceId: string }): Promise<ResolvedAI> {
  void workspaceId;
  const selection = await db.userAISelection.findUnique({ where: { userId }, include: { config: true } });
  if (selection?.mode === "ENV") return resolveFromEnv();

  if (selection?.mode === "CONFIG" && selection.config?.enabled) {
    const selected = selection.config;
    if (selected.scope === "GLOBAL") return buildProvider(selected, "global");
    if (selected.scope === "PERSONAL" && selected.ownerUserId === userId) return buildProvider(selected, "personal");
  }

  const globalDefault = await db.aIConfig.findFirst({
    where: { scope: "GLOBAL", enabled: true, isDefault: true },
    orderBy: { updatedAt: "desc" }
  });
  return globalDefault ? buildProvider(globalDefault, "global") : resolveFromEnv();
}

export function toActionError(error: unknown): AIConfigActionState {
  if (error instanceof AIConfigValidationError) {
    return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
  }
  const message = error instanceof Error && /APP_ENCRYPTION_KEY|SESSION_SECRET/.test(error.message)
    ? "服务器缺少可用的加密密钥，请配置 APP_ENCRYPTION_KEY 或长度至少 16 位的 SESSION_SECRET。"
    : "保存 AI 配置失败，请查看服务器日志。";
  console.error("AI configuration action failed", error);
  return { ok: false, message };
}
