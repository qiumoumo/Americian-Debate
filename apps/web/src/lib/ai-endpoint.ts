import { AIProviderError, createAIProviderFromConfig, THIRD_PARTY_PROVIDERS } from "@debate/ai";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { configureAIOutboundProxy } from "./ai-outbound-proxy.ts";

export interface AIEndpointInput {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  allowPrivateNetwork?: boolean;
}

export interface AIEndpointResult {
  ok: true;
  models: string[];
  baseUrl: string;
  latencyMs: number;
}

export class AIEndpointError extends Error {
  fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "AIEndpointError";
    this.fieldErrors = fieldErrors;
  }
}

function defaultBaseUrl(providerId: string) {
  if (providerId === "anthropic") return "https://api.anthropic.com/v1";
  return THIRD_PARTY_PROVIDERS[providerId]?.baseURL ?? "";
}

function stripEndpointPath(url: URL) {
  url.pathname = url.pathname
    .replace(/\/models\/?$/i, "")
    .replace(/\/chat\/completions\/?$/i, "")
    .replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function baseUrlCandidates(providerId: string, inputBaseUrl: string) {
  const value = inputBaseUrl.trim() || defaultBaseUrl(providerId);
  if (!value) {
    throw new AIEndpointError("请先填写 Base URL。", { baseUrl: "请输入 API 的基础地址，例如 https://api.example.com/v1。" });
  }

  let parsed: URL;
  try {
    parsed = stripEndpointPath(new URL(value));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
  } catch {
    throw new AIEndpointError("Base URL 格式不正确。", { baseUrl: "请输入有效的 HTTP(S) 地址。" });
  }

  const normalized = parsed.toString().replace(/\/$/, "");
  const candidates = [normalized];
  const hasVersionSegment = /\/v\d+(?:\.\d+)?$/i.test(parsed.pathname) || /\/v\d+(?:\.\d+)?\//i.test(parsed.pathname);
  if (!hasVersionSegment) {
    const versioned = new URL(parsed.toString());
    versioned.pathname = `${versioned.pathname.replace(/\/$/, "")}/v1`;
    candidates.push(versioned.toString().replace(/\/$/, ""));
  }
  return [...new Set(candidates)];
}

function requestHeaders(providerId: string, apiKey: string): Record<string, string> {
  if (providerId === "anthropic") {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      accept: "application/json"
    };
  }
  return { Authorization: `Bearer ${apiKey}`, accept: "application/json" };
}

function modelIds(payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.models)
        ? record.models
        : [];
  const models = rows.flatMap((row) => {
    if (typeof row === "string") return [row];
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const value = item.id ?? item.name ?? item.model ?? item.slug;
    return typeof value === "string" && value.trim() && value.trim().length <= 200 ? [value.trim()] : [];
  });
  return [...new Set(models)].sort((left, right) => left.localeCompare(right)).slice(0, 500);
}

async function readJsonLimited(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new AIEndpointError("服务端响应过大，已停止读取。");
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AIEndpointError("服务端响应过大，已停止读取。");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(body);
  return text ? JSON.parse(text) as unknown : null;
}

async function errorMessage(response: Response) {
  try {
    const payload = await readJsonLimited(response, 64 * 1024) as Record<string, unknown>;
    const nested = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : null;
    const message = nested?.message ?? payload.message ?? payload.error;
    if (typeof message === "string") return message.slice(0, 240);
  } catch {
    // Some compatible endpoints return HTML or an empty body for errors.
  }
  return "";
}

function isPrivateIPv4(address: string) {
  const [a, b, c] = address.split(".").map(Number);
  return a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a === 0
    || a >= 224;
}

function isPrivateAddress(address: string) {
  if (isIP(address) === 4) return isPrivateIPv4(address);
  if (isIP(address) !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("ff") || normalized.startsWith("2001:db8:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIPv4(mapped[1] ?? "") : false;
}

async function assertSafeEndpoint(baseUrl: string, allowPrivateNetwork: boolean) {
  if (allowPrivateNetwork) return;
  const url = new URL(baseUrl);
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") {
    throw new AIEndpointError("出于安全原因，服务器不能探测本机或内网地址。", { baseUrl: "本地 AI 需由管理员设置 AI_ALLOW_PRIVATE_ENDPOINTS=true。" });
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AIEndpointError("无法解析 Base URL 的主机名。", { baseUrl: "请检查域名是否正确。" });
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new AIEndpointError("出于安全原因，服务器不能探测本机或内网地址。", { baseUrl: "本地 AI 需由管理员设置 AI_ALLOW_PRIVATE_ENDPOINTS=true。" });
  }
  if (url.protocol !== "https:") {
    throw new AIEndpointError("公网 AI 地址必须使用 HTTPS。", { baseUrl: "仅受信任的本地 AI 可通过 AI_ALLOW_PRIVATE_ENDPOINTS 使用 HTTP。" });
  }
}

function validateCredentials(input: AIEndpointInput, requireModel = false) {
  if (input.providerId === "mock") {
    return;
  }
  if (!input.apiKey.trim()) {
    throw new AIEndpointError("请先填写 API Key。", { apiKey: "新配置需要填写密钥；已保存配置可留空使用原密钥。" });
  }
  if (requireModel && !input.model.trim()) {
    throw new AIEndpointError("请先填写模型名称。", { model: "测试连接需要指定要使用的模型。" });
  }
}

async function discoverModels(input: AIEndpointInput): Promise<AIEndpointResult> {
  if (input.providerId === "mock") {
    return { ok: true, models: ["mock-local"], baseUrl: "", latencyMs: 0 };
  }
  validateCredentials(input);
  configureAIOutboundProxy();

  const candidates = baseUrlCandidates(input.providerId, input.baseUrl);
  let lastFailure = "无法连接到模型列表端点。";
  let authenticationFailed = false;
  for (const baseUrl of candidates) {
    const startedAt = performance.now();
    try {
      await assertSafeEndpoint(baseUrl, Boolean(input.allowPrivateNetwork));
      const response = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: requestHeaders(input.providerId, input.apiKey),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
        redirect: "error"
      });
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      if (response.status === 401 || response.status === 403) {
        authenticationFailed = true;
        lastFailure = "API Key 未通过验证，请检查密钥或账号权限。";
        continue;
      }
      if (!response.ok) {
        const detail = await errorMessage(response);
        lastFailure = `模型端点返回 HTTP ${response.status}${detail ? `：${detail}` : ""}`;
        if (response.status === 404 || response.status === 405) continue;
        throw new AIEndpointError(lastFailure);
      }

      const payload = await readJsonLimited(response, 1024 * 1024).catch((error) => {
        if (error instanceof AIEndpointError) throw error;
        return null;
      });
      const models = modelIds(payload);
      if (!models.length) {
        lastFailure = "端点可以访问，但返回内容中没有可识别的模型列表。";
        continue;
      }
      return { ok: true, models, baseUrl, latencyMs };
    } catch (error) {
      if (error instanceof AIEndpointError) throw error;
      const message = error instanceof Error && error.name === "TimeoutError"
        ? "连接超时（10 秒）。"
        : "网络连接失败，请检查 URL、代理或服务状态。";
      lastFailure = message;
    }
  }
  if (authenticationFailed) {
    throw new AIEndpointError("API Key 未通过验证，请检查密钥或账号权限。", { apiKey: "服务端拒绝了此密钥。" });
  }
  throw new AIEndpointError(lastFailure, { baseUrl: "请确认此地址提供兼容的 GET /models 接口。" });
}

export function discoverAIModels(input: AIEndpointInput) {
  return discoverModels(input);
}

function chatFailure(status: number, detail: string) {
  const suffix = detail ? `：${detail}` : "";
  if (status === 401 || status === 403) {
    return new AIEndpointError("API Key 未通过验证，请检查密钥或账号权限。", { apiKey: "服务端拒绝了此密钥。" });
  }
  if (/model|模型/i.test(detail)) {
    return new AIEndpointError(`模型不可用（HTTP ${status}）${suffix}`, { model: "请检查模型名称以及当前密钥是否有权使用该模型。" });
  }
  return new AIEndpointError(`聊天接口返回 HTTP ${status}${suffix}`, {
    baseUrl: status === 404 || status === 405 ? "请确认 Base URL 指向兼容的聊天 API，例如 https://api.example.com/v1。" : "请检查服务端返回的错误信息。"
  });
}

function errorChain(error: unknown) {
  const chain: unknown[] = [];
  let current = error;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = typeof current === "object" && "cause" in current ? (current as { cause?: unknown }).cause : null;
  }
  return chain;
}

function endpointErrorFromChain(error: unknown) {
  return errorChain(error).find((item): item is AIEndpointError => item instanceof AIEndpointError);
}

function providerFailure(error: unknown) {
  if (!(error instanceof AIProviderError)) {
    return {
      status: undefined,
      error: new AIEndpointError("网络连接失败，请检查 URL、服务器公网、代理或服务状态。", { baseUrl: "服务器无法连接到此 AI 地址。" })
    };
  }
  if (error.status) return { status: error.status, error: chatFailure(error.status, error.message.slice(0, 240)) };
  if (["empty-response", "provider"].includes(error.code)) {
    return {
      status: undefined,
      error: new AIEndpointError("服务端已响应，但返回内容不是兼容的聊天结果。", { baseUrl: "请确认此地址提供兼容的聊天接口。" })
    };
  }
  const timeout = error.code === "timeout";
  const permissionDenied = error.systemCode === "EACCES" || error.systemCode === "EPERM";
  return {
    status: undefined,
    error: new AIEndpointError(
      timeout
        ? "连接超时（15 秒）。"
        : permissionDenied
          ? "服务器进程没有公网访问权限。"
          : "网络连接失败，请检查 URL、服务器公网、代理或服务状态。",
      {
        baseUrl: timeout
          ? "聊天接口未在限定时间内响应。"
          : permissionDenied
            ? "请允许 Node.js 出站访问 HTTPS，或配置 HTTPS_PROXY 后重启服务。"
            : "服务器无法连接到此 AI 地址。"
      }
    )
  };
}

function limitedProbeFetch(maxBytes: number): typeof globalThis.fetch {
  return async (resource, init) => {
    const response = await fetch(resource, { ...init, redirect: "error" });
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > maxBytes) {
      await response.body?.cancel();
      throw new AIEndpointError("服务端响应过大，已停止读取。");
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AIEndpointError("服务端响应过大，已停止读取。");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  };
}

export async function testAIEndpointConnection(input: AIEndpointInput, options: { timeoutMs?: number } = {}): Promise<AIEndpointResult> {
  if (input.providerId === "mock") {
    return { ok: true, models: [], baseUrl: "", latencyMs: 0 };
  }
  validateCredentials(input, true);
  configureAIOutboundProxy();

  const candidates = baseUrlCandidates(input.providerId, input.baseUrl);
  const timeoutMs = Math.min(15_000, Math.max(1, Math.round(options.timeoutMs ?? 15_000)));
  let lastFailure: AIEndpointError | null = null;
  for (const baseUrl of candidates) {
    const startedAt = performance.now();
    try {
      await assertSafeEndpoint(baseUrl, Boolean(input.allowPrivateNetwork));
      const provider = createAIProviderFromConfig({
        providerId: input.providerId,
        apiKey: input.apiKey,
        baseURL: baseUrl,
        model: input.model,
        fetch: limitedProbeFetch(1024 * 1024),
        maxRetries: 0
      });
      await provider.chat({
        messages: [{ role: "user", content: "Reply with OK." }],
        maxOutputTokens: 8,
        timeoutMs
      });
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      return { ok: true, models: [], baseUrl, latencyMs };
    } catch (error) {
      if (error instanceof AIEndpointError) throw error;
      const nestedEndpointError = endpointErrorFromChain(error);
      if (nestedEndpointError) throw nestedEndpointError;
      const failure = providerFailure(error);
      if ((failure.status === 404 || failure.status === 405) && baseUrl !== candidates.at(-1)) {
        lastFailure = failure.error;
        continue;
      }
      throw failure.error;
    }
  }
  throw lastFailure ?? new AIEndpointError("无法连接到聊天接口。", { baseUrl: "请检查 Base URL。" });
}
