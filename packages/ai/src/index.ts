import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type AIProviderId = "mock" | "openclaw" | "openai-compatible" | "anthropic";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatInput {
  messages: ChatMessage[];
  temperatureHint?: "focused" | "balanced" | "creative";
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface ChatResult {
  providerId: AIProviderId;
  model: string;
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface StructuredInput<TSchema> extends ChatInput {
  schemaName: string;
  schema: TSchema;
}

export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsJsonSchema: boolean;
  supportsToolUse: boolean;
  supportsVision: boolean;
  supportsLongContext: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface ProviderConfigStatus {
  providerId: AIProviderId;
  configured: boolean;
  model: string;
  missingEnv: string[];
  keyLocation: string;
  capabilities: ProviderCapabilities;
}

export interface AIProvider {
  id: AIProviderId;
  chat(input: ChatInput): Promise<ChatResult>;
  generateStructured<T>(input: StructuredInput<unknown>): Promise<T>;
  getCapabilities(): ProviderCapabilities;
}

export interface PromptBundle {
  system: string;
  user: string;
}

export interface AIUsageEstimate {
  model: string;
  inputTokenEstimate: number;
  outputTokenEstimate: number;
  costEstimateCents: number;
}

export type AIProviderErrorCode = "configuration" | "authentication" | "model" | "timeout" | "network" | "refusal" | "truncated" | "context" | "unexpected-stop" | "empty-response" | "parse" | "provider";

export class AIProviderError extends Error {
  code: AIProviderErrorCode;
  providerId?: AIProviderId;
  status?: number;

  constructor(code: AIProviderErrorCode, message: string, options: { providerId?: AIProviderId; status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "AIProviderError";
    this.code = code;
    this.providerId = options.providerId;
    this.status = options.status;
  }
}

async function providerRequest<T>(providerId: AIProviderId, request: () => Promise<T>) {
  try {
    return await request();
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
    const message = error instanceof Error ? error.message : "AI provider request failed.";
    const code: AIProviderErrorCode = status === 401 || status === 403
      ? "authentication"
      : /model|模型/i.test(message)
        ? "model"
        : /timeout|timed out|aborted/i.test(`${error instanceof Error ? error.name : ""} ${message}`)
          ? "timeout"
          : status === undefined
            ? "network"
            : "provider";
    throw new AIProviderError(code, message, { providerId, status, cause: error });
  }
}

const AI_PROVIDER_IDS: AIProviderId[] = ["mock", "openclaw", "openai-compatible", "anthropic"];
const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";
const CONFIG_LOCATION = ".env.local or server environment";

export interface ThirdPartyProviderPreset {
  label: string;
  baseURL: string;
  defaultModel: string;
}

// Named third-party providers. All speak the OpenAI-compatible protocol, so they
// reuse OpenAICompatibleProvider with a built-in base URL — users only supply a
// key (and optionally override the model). Adding an entry here surfaces it in
// the AI config dropdowns automatically.
export const THIRD_PARTY_PROVIDERS: Record<string, ThirdPartyProviderPreset> = {
  openai: { label: "OpenAI（GPT）", baseURL: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  deepseek: { label: "DeepSeek 深度求索", baseURL: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  moonshot: { label: "Moonshot 月之暗面 / Kimi", baseURL: "https://api.moonshot.cn/v1", defaultModel: "moonshot-v1-8k" },
  zhipu: { label: "智谱 GLM", baseURL: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-flash" },
  qwen: { label: "阿里 通义千问", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus" },
  siliconflow: { label: "SiliconFlow 硅基流动", baseURL: "https://api.siliconflow.cn/v1", defaultModel: "deepseek-ai/DeepSeek-V3" },
  openrouter: { label: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini" }
};

export interface AIProviderChoice {
  id: string;
  label: string;
  needsBaseUrl: boolean;
}

/** Ordered list of provider choices shown in the AI config UI. */
export const AI_PROVIDER_CHOICES: AIProviderChoice[] = [
  { id: "mock", label: "mock（本地免费，无需密钥）", needsBaseUrl: false },
  { id: "anthropic", label: "Anthropic（Claude）", needsBaseUrl: false },
  ...Object.entries(THIRD_PARTY_PROVIDERS).map(([id, preset]) => ({ id, label: preset.label, needsBaseUrl: false })),
  { id: "openai-compatible", label: "自定义 OpenAI 兼容端点", needsBaseUrl: true },
  { id: "openclaw", label: "OpenClaw", needsBaseUrl: true }
];

/** All valid provider ids for stored configs (base providers + third-party presets). */
export const AI_PROVIDER_CHOICE_IDS: string[] = AI_PROVIDER_CHOICES.map((choice) => choice.id);

/** Resolves the effective model string for a stored config provider id. */
export function resolveConfigModel(providerId: string, model: string): string {
  if (model) return model;
  const preset = THIRD_PARTY_PROVIDERS[providerId];
  if (preset) return preset.defaultModel;
  if (AI_PROVIDER_IDS.includes(providerId as AIProviderId)) {
    return getConfiguredAIModel(providerId as AIProviderId);
  }
  return "";
}

const PRICE_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  mock: { input: 0, output: 0 },
  "mock-local": { input: 0, output: 0 },
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 5, output: 15 },
  "claude-opus-4-8": { input: 15, output: 75 }
};

function parseProviderId(value: string | undefined): AIProviderId | null {
  const provider = value ?? "mock";
  return AI_PROVIDER_IDS.includes(provider as AIProviderId) ? provider as AIProviderId : null;
}

function toOpenAIMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message) => ({ role: message.role, content: message.content }) as ChatCompletionMessageParam);
}

function missingEnvEntries(entries: Array<[string, string | undefined]>): string[] {
  return entries.filter(([, value]) => !value).map(([name]) => name);
}

function joinMessages(messages: ChatMessage[]): string {
  return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}

export function messagesFromPromptBundle(prompt: PromptBundle): ChatMessage[] {
  return [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user }
  ];
}

export function promptBundleToCopyText(prompt: PromptBundle) {
  return [
    "SYSTEM",
    prompt.system,
    "",
    "USER",
    prompt.user
  ].join("\n");
}

export function estimateTokens(value: unknown) {
  return Math.ceil((typeof value === "string" ? value : JSON.stringify(value)).length / 4);
}

export function getConfiguredAIModel(providerId: string, env: NodeJS.ProcessEnv = process.env) {
  if (providerId === "mock") {
    return "mock-local";
  }
  if (providerId === "anthropic") {
    return env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  }
  if (providerId === "openclaw") {
    return env.OPENCLAW_MODEL ?? "configured-model";
  }
  if (providerId === "openai-compatible") {
    return env.OPENAI_COMPATIBLE_MODEL ?? "configured-model";
  }
  return env.ANTHROPIC_MODEL ?? env.OPENCLAW_MODEL ?? env.OPENAI_COMPATIBLE_MODEL ?? "configured-model";
}

function readPrice(model: string) {
  const normalized = model.toLowerCase();
  return PRICE_PER_MILLION_TOKENS_USD[normalized] ?? { input: 0, output: 0 };
}

export function estimateAIUsageCost(input: { providerId: string; model?: string; input: unknown; output: unknown }): AIUsageEstimate {
  const model = input.model ?? getConfiguredAIModel(input.providerId);
  const inputTokenEstimate = estimateTokens(input.input);
  const outputTokenEstimate = estimateTokens(input.output);
  const price = readPrice(model);
  const usd = ((inputTokenEstimate / 1_000_000) * price.input) + ((outputTokenEstimate / 1_000_000) * price.output);

  return {
    model,
    inputTokenEstimate,
    outputTokenEstimate,
    costEstimateCents: Math.max(0, Math.ceil(usd * 100))
  };
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new AIProviderError("empty-response", "AI response was empty.");
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch (innerError) {
        throw new AIProviderError("parse", "AI response did not contain valid JSON.", { cause: innerError });
      }
    }
    throw new AIProviderError("parse", "AI response did not contain valid JSON.", { cause: error });
  }
}

function readRequiredText(raw: string | null | undefined, providerId: AIProviderId) {
  const text = raw ?? "";
  if (!text.trim()) {
    throw new AIProviderError("empty-response", "AI provider returned an empty response.", { providerId });
  }
  return text;
}

function validateOpenAIConfig(options: { providerId: AIProviderId; apiKey: string; baseURL: string; model: string }) {
  const missing = missingEnvEntries([
    ["apiKey", options.apiKey],
    ["baseURL", options.baseURL],
    ["model", options.model]
  ]);
  if (missing.length) {
    throw new AIProviderError("configuration", `${options.providerId} provider is missing required configuration: ${missing.join(", ")}.`, { providerId: options.providerId });
  }
}

function normalizeAnthropicBaseURL(baseURL: string | undefined) {
  if (!baseURL) return undefined;
  try {
    const url = new URL(baseURL);
    url.pathname = url.pathname.replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return baseURL;
  }
}

function assertOpenAIChoice(choice: { finish_reason: string | null } | undefined, providerId: AIProviderId) {
  if (!choice) {
    throw new AIProviderError("empty-response", "AI provider returned no choices.", { providerId });
  }

  switch (choice.finish_reason) {
    case "stop":
    case null:
      return;
    case "length":
      throw new AIProviderError("truncated", "AI provider stopped because the output length limit was reached.", { providerId });
    case "content_filter":
      throw new AIProviderError("refusal", "AI provider refused or filtered the response.", { providerId });
    case "tool_calls":
    case "function_call":
      throw new AIProviderError("unexpected-stop", "AI provider requested a tool call, but this provider wrapper does not run tools.", { providerId });
    default:
      throw new AIProviderError("unexpected-stop", `AI provider stopped unexpectedly: ${choice.finish_reason}.`, { providerId });
  }
}

function splitAnthropicMessages(messages: ChatMessage[]) {
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n") || undefined;
  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));

  if (!conversation.length || conversation[0]?.role !== "user") {
    throw new AIProviderError("configuration", "Anthropic requests must include at least one user message and the first non-system message must be from the user.", { providerId: "anthropic" });
  }

  return { system, messages: conversation };
}

function supportsAdaptiveThinking(model: string) {
  return [
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-5",
    "claude-sonnet-4-6"
  ].includes(model);
}

function supportsEffort(model: string) {
  return supportsAdaptiveThinking(model) || model === "claude-fable-5" || model === "claude-mythos-5";
}

function anthropicGenerationOptions(model: string): Partial<Anthropic.MessageCreateParamsNonStreaming> {
  return {
    ...(supportsAdaptiveThinking(model) ? { thinking: { type: "adaptive" as const } } : {}),
    ...(supportsEffort(model) ? { output_config: { effort: "high" as const } } : {})
  };
}

function outputConfigWithSchema(model: string, schema: unknown): Anthropic.OutputConfig {
  const schemaObject = typeof schema === "object" && schema !== null && !Array.isArray(schema)
    ? schema as Record<string, unknown>
    : { type: "object", additionalProperties: true };

  return {
    ...(supportsEffort(model) ? { effort: "high" as const } : {}),
    format: {
      type: "json_schema",
      schema: schemaObject
    }
  };
}

function assertAnthropicCompletion(response: Anthropic.Message, operation: string) {
  const stopReason = String(response.stop_reason ?? "");
  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
      return;
    case "refusal": {
      const category = response.stop_details?.category ? ` (${response.stop_details.category})` : "";
      throw new AIProviderError("refusal", `Anthropic refused the ${operation} request${category}.`, { providerId: "anthropic" });
    }
    case "max_tokens":
      throw new AIProviderError("truncated", `Anthropic truncated the ${operation} response at max_tokens.`, { providerId: "anthropic" });
    case "model_context_window_exceeded":
      throw new AIProviderError("context", `Anthropic could not complete the ${operation} request because the context window was exceeded.`, { providerId: "anthropic" });
    case "tool_use":
    case "pause_turn":
      throw new AIProviderError("unexpected-stop", `Anthropic stopped with ${stopReason}, but this provider wrapper does not run tools or resume paused turns.`, { providerId: "anthropic" });
    default:
      throw new AIProviderError("unexpected-stop", `Anthropic stopped unexpectedly during ${operation}: ${stopReason || "unknown"}.`, { providerId: "anthropic" });
  }
}

function readAnthropicText(response: Anthropic.Message, operation: string) {
  assertAnthropicCompletion(response, operation);
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return readRequiredText(text, "anthropic");
}

export class MockProvider implements AIProvider {
  id: AIProviderId = "mock";

  async chat(input: ChatInput): Promise<ChatResult> {
    return {
      providerId: this.id,
      model: "mock-local",
      text: `Mock AI response. Received ${input.messages.length} messages.\n\n${joinMessages(input.messages).slice(0, 700)}`,
      usage: {
        inputTokens: Math.ceil(joinMessages(input.messages).length / 4),
        outputTokens: 80
      }
    };
  }

  async generateStructured<T>(input: StructuredInput<unknown>): Promise<T> {
    if (input.schemaName === "PracticeFeedback") {
      return {
        score: 82,
        feedback: "Mock feedback: your argument has clear clash. Add explicit weighing before the last response.",
        rubric: {
          clash: { score: 84, comment: "Direct clash on the main link; answer their turn earlier." },
          evidenceExtension: { score: 78, comment: "Re-explain the warrant when you extend, not just the tag." },
          weighing: { score: 72, comment: "Add comparative weighing on timeframe before the last speech." },
          collapse: { score: 80, comment: "Good instinct to collapse; commit to one voter sooner." },
          lineByLineEfficiency: { score: 85, comment: "Clean line-by-line; trim the repeated overview." }
        },
        strengths: ["Clear claim", "Good evidence framing"],
        weaknesses: ["Needs comparative weighing", "Frontline should be shorter"],
        nextDrills: ["30-second weighing drill", "One-card extension drill"]
      } as T;
    }

    if (input.schemaName === "PracticeDrills") {
      return {
        drills: [
          {
            title: "30-second weighing drill",
            instructions: "In 30 seconds, weigh your best impact against the opponent's on magnitude, probability, and timeframe.",
            targetDimension: "weighing",
            durationSeconds: 30,
            promptText: "Weigh your strongest impact against their strongest impact. Be explicitly comparative."
          },
          {
            title: "Answer this turn",
            instructions: "The opponent has turned your case. Answer the turn cleanly in one response, then extend your offense.",
            targetDimension: "clash",
            durationSeconds: 45,
            promptText: "They read a link turn on your advantage. Answer it and explain why your offense still outweighs."
          },
          {
            title: "Collapse to one voter",
            instructions: "Collapse the round to a single voting issue and rebuild weighing around it.",
            targetDimension: "collapse",
            durationSeconds: 60,
            promptText: "Pick the one argument you are winning and write a final-focus-style collapse around it."
          }
        ]
      } as T;
    }

    if (input.schemaName === "FlowRebuttalSuggestions") {
      return {
        responses: [
          {
            label: "No link",
            category: "answer",
            response: "Their evidence is about a different mechanism; deny the internal link before it becomes offense.",
            strategy: "delink",
            evidenceIds: []
          },
          {
            label: "Turn the impact",
            category: "turn",
            response: "Concede their link but weigh long-run productivity; the turn outweighs on magnitude and timeframe.",
            strategy: "impact turn",
            evidenceIds: []
          },
          {
            label: "Weigh timeframe",
            category: "weigh",
            response: "Even if the link is true, our benefit compounds while their harm is short-run — timeframe comes first.",
            strategy: "comparative weighing",
            evidenceIds: []
          },
          {
            label: "Collapse here",
            category: "collapse",
            response: "In the last speech, go for the turn only and extend it clean; drop the smaller answers.",
            strategy: "collapse + extend",
            evidenceIds: []
          }
        ],
        weighing: ["Weigh on timeframe: their harm is short-run, our benefit compounds."]
      } as T;
    }

    return {
      ourCase: [
        {
          speech: "Constructive",
          argument: "Use the selected evidence as offense, then collapse to one clean weighing story.",
          evidenceIds: ["ev-labor-01"],
          suggestedText: "Extend labor complementarity and compare it against their fiscal-cost framing."
        }
      ],
      frontlines: [
        {
          opponentArgument: "Fiscal pressure outweighs growth",
          response: "Concede short-run costs but weigh long-run productivity and tax-base growth.",
          evidenceIds: ["ev-fiscal-02"]
        }
      ],
      risks: ["Replace this mock output with a real provider before relying on it in round."]
    } as T;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsJsonSchema: true,
      supportsToolUse: false,
      supportsVision: false,
      supportsLongContext: false
    };
  }
}

export class OpenAICompatibleProvider implements AIProvider {
  id: AIProviderId;
  private client: OpenAI;
  private model: string;

  constructor(options: { id?: AIProviderId; apiKey: string; baseURL: string; model: string; fetch?: typeof globalThis.fetch; maxRetries?: number }) {
    this.id = options.id ?? "openai-compatible";
    validateOpenAIConfig({ providerId: this.id, apiKey: options.apiKey, baseURL: options.baseURL, model: options.model });
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      fetch: options.fetch,
      maxRetries: options.maxRetries
    });
    this.model = options.model;
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const response = await providerRequest(this.id, () => this.client.chat.completions.create({
        model: this.model,
        messages: toOpenAIMessages(input.messages),
        ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {})
      }, input.timeoutMs ? { timeout: input.timeoutMs } : undefined));
    const choice = response.choices?.[0];
    assertOpenAIChoice(choice, this.id);

    return {
      providerId: this.id,
      model: this.model,
      text: readRequiredText(choice.message?.content, this.id),
      usage: {
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens
      }
    };
  }

  async generateStructured<T>(input: StructuredInput<unknown>): Promise<T> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: toOpenAIMessages([
        ...input.messages,
        {
          role: "user",
          content: `Return valid JSON only for schema ${input.schemaName}. Schema hint: ${JSON.stringify(input.schema)}`
        }
      ]),
      response_format: { type: "json_object" }
    });
    const choice = response.choices[0];
    assertOpenAIChoice(choice, this.id);

    return extractJson(readRequiredText(choice.message?.content, this.id)) as T;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsJsonSchema: false,
      supportsToolUse: true,
      supportsVision: false,
      supportsLongContext: false
    };
  }
}

export class AnthropicProvider implements AIProvider {
  id: AIProviderId = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(options: { apiKey?: string; model?: string; baseURL?: string; fetch?: typeof globalThis.fetch; maxRetries?: number } = {}) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: normalizeAnthropicBaseURL(options.baseURL),
      fetch: options.fetch,
      maxRetries: options.maxRetries
    });
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const { system, messages } = splitAnthropicMessages(input.messages);

    const response = await providerRequest(this.id, () => this.client.messages.create({
        model: this.model,
        max_tokens: input.maxOutputTokens ?? 16000,
        system,
        messages,
        ...anthropicGenerationOptions(this.model)
      }, input.timeoutMs ? { timeout: input.timeoutMs } : undefined));

    return {
      providerId: this.id,
      model: response.model,
      text: readAnthropicText(response, "chat"),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      }
    };
  }

  async generateStructured<T>(input: StructuredInput<unknown>): Promise<T> {
    const { system, messages } = splitAnthropicMessages(input.messages);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      system,
      messages: [
        ...messages,
        {
          role: "user",
          content: `Return JSON for schema ${input.schemaName}. Do not include markdown fences or explanatory prose.`
        }
      ],
      ...(supportsAdaptiveThinking(this.model) ? { thinking: { type: "adaptive" as const } } : {}),
      output_config: outputConfigWithSchema(this.model, input.schema)
    });

    return extractJson(readAnthropicText(response, `structured ${input.schemaName}`)) as T;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsJsonSchema: true,
      supportsToolUse: true,
      supportsVision: true,
      supportsLongContext: true,
      maxInputTokens: 1_000_000,
      maxOutputTokens: 128_000
    };
  }
}

export function createAIProviderFromConfig(config: {
  providerId: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  fetch?: typeof globalThis.fetch;
  maxRetries?: number;
}): AIProvider {
  const preset = THIRD_PARTY_PROVIDERS[config.providerId];
  if (preset) {
    return new OpenAICompatibleProvider({
      apiKey: config.apiKey ?? "",
      baseURL: config.baseURL || preset.baseURL,
      model: config.model || preset.defaultModel,
      fetch: config.fetch,
      maxRetries: config.maxRetries
    });
  }

  if (config.providerId === "openclaw") {
    return new OpenAICompatibleProvider({
      id: "openclaw",
      apiKey: config.apiKey ?? "",
      baseURL: config.baseURL ?? "",
      model: config.model ?? "",
      fetch: config.fetch,
      maxRetries: config.maxRetries
    });
  }

  if (config.providerId === "openai-compatible") {
    return new OpenAICompatibleProvider({
      apiKey: config.apiKey ?? "",
      baseURL: config.baseURL ?? "",
      model: config.model ?? "",
      fetch: config.fetch,
      maxRetries: config.maxRetries
    });
  }

  if (config.providerId === "anthropic") {
    return new AnthropicProvider({
      apiKey: config.apiKey,
      model: config.model ?? DEFAULT_ANTHROPIC_MODEL,
      baseURL: config.baseURL,
      fetch: config.fetch,
      maxRetries: config.maxRetries
    });
  }

  return new MockProvider();
}

export function createAIProviderFromEnv(env: NodeJS.ProcessEnv = process.env): AIProvider {
  const provider = parseProviderId(env.AI_PROVIDER);
  if (!provider) {
    throw new AIProviderError("configuration", `Unknown AI_PROVIDER: ${env.AI_PROVIDER}. Expected one of ${AI_PROVIDER_IDS.join(", ")}.`);
  }

  if (provider === "openclaw") {
    return new OpenAICompatibleProvider({
      id: "openclaw",
      apiKey: env.OPENCLAW_API_KEY ?? "",
      baseURL: env.OPENCLAW_BASE_URL ?? "",
      model: env.OPENCLAW_MODEL ?? ""
    });
  }

  if (provider === "openai-compatible") {
    return new OpenAICompatibleProvider({
      apiKey: env.OPENAI_COMPATIBLE_API_KEY ?? "",
      baseURL: env.OPENAI_COMPATIBLE_BASE_URL ?? "",
      model: env.OPENAI_COMPATIBLE_MODEL ?? ""
    });
  }

  if (provider === "anthropic") {
    return new AnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL
    });
  }

  return new MockProvider();
}

function hasAnthropicCredentialHint(env: NodeJS.ProcessEnv) {
  return Boolean(
    env.ANTHROPIC_API_KEY ||
    env.ANTHROPIC_AUTH_TOKEN ||
    env.ANTHROPIC_PROFILE ||
    (env.ANTHROPIC_FEDERATION_RULE_ID && env.ANTHROPIC_ORGANIZATION_ID && env.ANTHROPIC_SERVICE_ACCOUNT_ID && (env.ANTHROPIC_IDENTITY_TOKEN_FILE || env.ANTHROPIC_IDENTITY_TOKEN))
  );
}

export function getAIProviderConfigStatus(env: NodeJS.ProcessEnv = process.env): ProviderConfigStatus {
  const provider = parseProviderId(env.AI_PROVIDER);
  const keyLocation = CONFIG_LOCATION;

  if (!provider) {
    const mock = new MockProvider();
    return {
      providerId: "mock",
      configured: false,
      model: `Invalid AI_PROVIDER: ${env.AI_PROVIDER}`,
      missingEnv: ["AI_PROVIDER"],
      keyLocation,
      capabilities: mock.getCapabilities()
    };
  }

  if (provider === "openclaw") {
    const missingEnv = missingEnvEntries([
      ["OPENCLAW_BASE_URL", env.OPENCLAW_BASE_URL],
      ["OPENCLAW_API_KEY", env.OPENCLAW_API_KEY],
      ["OPENCLAW_MODEL", env.OPENCLAW_MODEL]
    ]);
    return {
      providerId: provider,
      configured: missingEnv.length === 0,
      model: env.OPENCLAW_MODEL ?? "",
      missingEnv,
      keyLocation,
      capabilities: { supportsStreaming: true, supportsJsonSchema: false, supportsToolUse: true, supportsVision: false, supportsLongContext: false }
    };
  }

  if (provider === "openai-compatible") {
    const missingEnv = missingEnvEntries([
      ["OPENAI_COMPATIBLE_BASE_URL", env.OPENAI_COMPATIBLE_BASE_URL],
      ["OPENAI_COMPATIBLE_API_KEY", env.OPENAI_COMPATIBLE_API_KEY],
      ["OPENAI_COMPATIBLE_MODEL", env.OPENAI_COMPATIBLE_MODEL]
    ]);
    return {
      providerId: provider,
      configured: missingEnv.length === 0,
      model: env.OPENAI_COMPATIBLE_MODEL ?? "",
      missingEnv,
      keyLocation,
      capabilities: { supportsStreaming: true, supportsJsonSchema: false, supportsToolUse: true, supportsVision: false, supportsLongContext: false }
    };
  }

  if (provider === "anthropic") {
    const missingEnv = hasAnthropicCredentialHint(env) ? [] : ["ANTHROPIC_API_KEY or Anthropic SDK credential profile"];
    const instance = new AnthropicProvider({ model: env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL });
    return {
      providerId: provider,
      configured: missingEnv.length === 0,
      model: env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
      missingEnv,
      keyLocation,
      capabilities: instance.getCapabilities()
    };
  }

  const mock = new MockProvider();
  return {
    providerId: "mock",
    configured: true,
    model: "mock-local",
    missingEnv: [],
    keyLocation,
    capabilities: mock.getCapabilities()
  };
}
