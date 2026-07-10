import type { AiPersona, DebateFormat, PracticeMode, PracticeRoundState, Side } from "@debate/shared";
import { aiPersonaDirectives } from "@debate/shared";
import { messagesFromPromptBundle, promptBundleToCopyText, type AIProvider, type PromptBundle } from "./index.ts";
import {
  normalizePracticeDrills,
  normalizePracticeFeedback,
  practiceDrillsJsonSchema,
  practiceFeedbackJsonSchema,
  type PracticeDrillsShape,
  type PracticeFeedbackShape
} from "./schemas.ts";

export interface PracticeContext {
  mode?: PracticeMode | string;
  speechRole?: string;
  roundPhase?: string;
  aiPersona?: AiPersona | string;
  persona?: AiPersona | string;
  rubricFocus?: string[];
  /** Round-state 由路由算好传入（保持 AI 包纯净，不依赖 formatConfigs 遍历）。 */
  roundState?: PracticeRoundState;
  /** Rolling summary of earlier turns that were compressed out of the transcript. */
  conversationSummary?: string;
}

export interface GeneratePracticeReplyInput {
  provider: AIProvider;
  topic: string;
  format: DebateFormat;
  side: Side;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  context?: PracticeContext;
}

export interface GeneratePracticeFeedbackInput {
  provider: AIProvider;
  topic: string;
  format: DebateFormat;
  side: Side;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  context?: PracticeContext;
}

function defaultRubricFocus(input?: PracticeContext) {
  return input?.rubricFocus?.length
    ? input.rubricFocus
    : ["clash", "evidence extension", "weighing", "strategic collapse", "line-by-line efficiency"];
}

function resolvePersona(context: PracticeContext): AiPersona {
  const raw = context.persona ?? context.aiPersona;
  return raw && raw in aiPersonaDirectives ? (raw as AiPersona) : "technical-opponent";
}

/** 每个模式替换 opponent prompt 的 instructions 块。 */
function opponentInstructionsForMode(mode: PracticeMode | string | undefined): string[] {
  switch (mode) {
    case "speech-drill":
      return [
        "The debater is delivering one full speech. Respond as a flow-style, block-by-block rebuttal to THAT speech only.",
        "Answer their arguments line by line; do not open unrelated new offense.",
        "End by naming the one argument they most need to fix next."
      ];
    case "crossfire":
      return [
        "This is crossfire. Reply with exactly ONE short question OR one short answer — never a mini-speech.",
        "Keep it to at most 2 sentences. Corner evasions and press for concessions.",
        "If the debater asked you a question, answer it tightly, then optionally ask one pointed follow-up."
      ];
    case "rebuttal-drill":
      return [
        "This is a rebuttal drill. Present ONE clean argument or turn and demand the debater answer it THIS turn.",
        "After they answer, judge whether the answer actually resolves your argument and say why.",
        "Stay on this single argument until it is resolved."
      ];
    case "weighing-drill":
      return [
        "This is a weighing drill. Force comparative weighing on magnitude, probability, timeframe, and scope.",
        "Reject any non-comparative claim and push the debater to say why their impact comes first.",
        "End with a weighing challenge they must answer."
      ];
    case "text-spar":
    default:
      return [
        "Reply as the opponent.",
        "Use direct clash before new offense.",
        "End with one concise pressure question or weighing challenge."
      ];
  }
}

export function buildPracticeOpponentPrompt(input: Omit<GeneratePracticeReplyInput, "provider">): PromptBundle {
  const context = input.context ?? {};
  const mode = context.mode ?? "text-spar";
  const persona = resolvePersona(context);
  const roundState = context.roundState;
  return {
    system: [
      "You are a competitive debate practice opponent, not a generic chatbot.",
      "Stay in round, answer as the opposing side, and keep replies short enough for text practice.",
      "Pressure weak links, identify dropped arguments, and force comparative weighing.",
      aiPersonaDirectives[persona],
      "Do not pretend to be a real person."
    ].join(" "),
    user: JSON.stringify({
      topic: input.topic,
      format: input.format,
      userSide: input.side,
      mode,
      aiPersona: persona,
      currentSpeech: roundState?.currentSpeech?.speech ?? context.speechRole ?? "next speech",
      opponentSpeech: roundState?.opponentSpeech?.speech,
      roundPhase: roundState?.phaseLabel ?? context.roundPhase ?? "practice exchange",
      rubricFocus: defaultRubricFocus(context),
      conversationSummary: context.conversationSummary || undefined,
      transcript: input.transcript,
      latestUserMessage: input.userMessage,
      instructions: [
        "Treat conversationSummary (if present) as the compressed record of earlier turns that scrolled out of the transcript — stay consistent with it.",
        "Argue as if we are at the point in the round named by roundPhase / currentSpeech.",
        ...opponentInstructionsForMode(mode)
      ]
    }, null, 2)
  };
}

export function buildPracticeFeedbackPrompt(input: Omit<GeneratePracticeFeedbackInput, "provider">): PromptBundle {
  const context = input.context ?? {};
  return {
    system: [
      "You are a debate coach. Return JSON feedback only.",
      "Score five rubric dimensions 0-100 each (clash, evidenceExtension, weighing, collapse, lineByLineEfficiency), each with a concise comment.",
      "Also give an overall 0-100 score, a short feedback paragraph, strengths, weaknesses, and next drills."
    ].join(" "),
    user: JSON.stringify({
      topic: input.topic,
      format: input.format,
      side: input.side,
      mode: context.mode ?? "text-spar",
      speechRole: context.roundState?.currentSpeech?.speech ?? context.speechRole ?? "mixed practice",
      roundPhase: context.roundState?.phaseLabel ?? context.roundPhase ?? "post-practice review",
      rubricFocus: defaultRubricFocus(context),
      conversationSummary: context.conversationSummary || undefined,
      transcript: input.transcript,
      rubricGuidance: {
        clash: "direct engagement with the opponent's arguments before new offense",
        evidenceExtension: "re-warranting and extending evidence, not just re-tagging",
        weighing: "comparative magnitude / probability / timeframe / scope",
        collapse: "narrowing to the cleanest offense in later speeches",
        lineByLineEfficiency: "coverage and brevity on the flow, no wasted time"
      },
      scoringGuidance: {
        90: "round-ready, strategic, and efficient",
        80: "strong but missing one clear layer of comparison or coverage",
        70: "usable basics with repeated gaps",
        60: "needs rebuilding before a round"
      },
      output: {
        score: "number 0-100",
        feedback: "short paragraph",
        rubric: {
          clash: { score: "0-100", comment: "string" },
          evidenceExtension: { score: "0-100", comment: "string" },
          weighing: { score: "0-100", comment: "string" },
          collapse: { score: "0-100", comment: "string" },
          lineByLineEfficiency: { score: "0-100", comment: "string" }
        },
        strengths: ["string"],
        weaknesses: ["string"],
        nextDrills: ["string"]
      }
    }, null, 2)
  };
}

export function buildPracticeOpponentCopyPrompt(input: Omit<GeneratePracticeReplyInput, "provider">) {
  return promptBundleToCopyText(buildPracticeOpponentPrompt(input));
}

export function buildPracticeFeedbackCopyPrompt(input: Omit<GeneratePracticeFeedbackInput, "provider">) {
  return promptBundleToCopyText(buildPracticeFeedbackPrompt(input));
}

export async function generatePracticeOpponentReply(input: GeneratePracticeReplyInput) {
  const messages = messagesFromPromptBundle(buildPracticeOpponentPrompt(input));

  const result = await input.provider.chat({ messages });
  return result.text || "Mock opponent: Answer with weighing, then pressure the link chain.";
}

export async function generatePracticeFeedback(input: GeneratePracticeFeedbackInput): Promise<PracticeFeedbackShape> {
  const prompt = buildPracticeFeedbackPrompt(input);
  const raw = await input.provider.generateStructured<unknown>({
    schemaName: "PracticeFeedback",
    schema: practiceFeedbackJsonSchema,
    messages: messagesFromPromptBundle(prompt)
  });

  return normalizePracticeFeedback(raw);
}

export interface SummarizePracticeInput {
  provider: AIProvider;
  topic: string;
  format: DebateFormat;
  side: Side;
  /** Prior rolling summary to fold the new turns into (empty on first compression). */
  priorSummary: string;
  /** The turns being compressed out of the live transcript, in order. */
  turnsToCompress: Array<{ role: "user" | "assistant"; content: string }>;
}

export function buildPracticeSummaryPrompt(input: Omit<SummarizePracticeInput, "provider">): PromptBundle {
  return {
    system: [
      "You compress a debate practice transcript into a compact running memory.",
      "Preserve what matters for continuing the round: each side's positions, arguments already made and dropped,",
      "key clashes, concessions, evidence referenced, and open weighing threads.",
      "Do not add new analysis or opinions. Be terse. Output plain prose, no markdown, under 220 words."
    ].join(" "),
    user: JSON.stringify({
      topic: input.topic,
      format: input.format,
      userSide: input.side,
      priorSummary: input.priorSummary || "(none yet)",
      newTurnsToFoldIn: input.turnsToCompress,
      instructions: [
        "Merge priorSummary with newTurnsToFoldIn into one updated summary.",
        "Keep it self-contained so a debater could resume from it alone.",
        "Prefer bullet-like short sentences over long paragraphs."
      ]
    }, null, 2)
  };
}

export function buildPracticeSummaryCopyPrompt(input: Omit<SummarizePracticeInput, "provider">) {
  return promptBundleToCopyText(buildPracticeSummaryPrompt(input));
}

export async function summarizePracticeTranscript(input: SummarizePracticeInput): Promise<string> {
  if (!input.turnsToCompress.length) {
    return input.priorSummary;
  }

  const messages = messagesFromPromptBundle(buildPracticeSummaryPrompt(input));
  const result = await input.provider.chat({ messages, temperatureHint: "focused" });
  const summary = result.text.trim();
  // Never lose the prior summary if the provider returns nothing usable.
  return summary || input.priorSummary;
}

// ── Drill 生成器（结构化输出，照抄 flow.ts 范式） ────────────────

export interface GeneratePracticeDrillsInput {
  provider: AIProvider;
  topic: string;
  format: DebateFormat;
  side: Side;
  context?: PracticeContext;
  /** 最近若干轮 transcript，用于让 drill 贴合当前训练。 */
  transcript?: Array<{ role: "user" | "assistant"; content: string }>;
  /** 期望生成的 drill 数量（默认 3）。 */
  count?: number;
}

export function buildPracticeDrillsPrompt(input: Omit<GeneratePracticeDrillsInput, "provider">): PromptBundle {
  const context = input.context ?? {};
  return {
    system: [
      "You are a debate drill coach. Return only JSON matching the requested shape.",
      "Generate short, concrete practice tasks the debater can do right now, e.g. '30-second weighing drill', 'answer this turn', 'collapse to one voter'.",
      "Each drill targets one rubric dimension and includes an actual promptText the debater must respond to."
    ].join(" "),
    user: JSON.stringify({
      topic: input.topic,
      format: input.format,
      side: input.side,
      mode: context.mode ?? "text-spar",
      roundPhase: context.roundState?.phaseLabel ?? context.roundPhase ?? "practice",
      currentSpeech: context.roundState?.currentSpeech?.speech,
      rubricFocus: defaultRubricFocus(context),
      recentTranscript: (input.transcript ?? []).slice(-6),
      count: input.count ?? 3,
      output: {
        drills: [
          {
            title: "string",
            instructions: "string",
            targetDimension: "clash | evidenceExtension | weighing | collapse | lineByLineEfficiency | general",
            durationSeconds: "number (15-600)",
            promptText: "the exact task the debater responds to"
          }
        ]
      }
    }, null, 2)
  };
}

export function buildPracticeDrillsCopyPrompt(input: Omit<GeneratePracticeDrillsInput, "provider">) {
  return promptBundleToCopyText(buildPracticeDrillsPrompt(input));
}

export async function generatePracticeDrills(input: GeneratePracticeDrillsInput): Promise<PracticeDrillsShape> {
  const prompt = buildPracticeDrillsPrompt(input);
  const raw = await input.provider.generateStructured<unknown>({
    schemaName: "PracticeDrills",
    schema: practiceDrillsJsonSchema,
    messages: messagesFromPromptBundle(prompt)
  });

  return normalizePracticeDrills(raw);
}

// ── 语音分析接口桩（future phase） ───────────────────────────────
// TODO(阶段 5 后续): 接入录音 → Whisper 转录 → text → 复用 feedback/rubric 管线。
// 未来实现 generateSpeechAnalysis 与 /api/ai/practice/speech 路由；此处仅定义 seam。

export interface SpeechAnalysisInput {
  provider: AIProvider;
  topic: string;
  format: DebateFormat;
  side: Side;
  /** Whisper 转录出的发言文本。 */
  transcript: string;
  /** 发言时长（毫秒），用于 wpm/pacing。 */
  durationMs: number;
  context?: PracticeContext;
}

export interface SpeechAnalysisShape {
  transcript: string;
  /** 每分钟词数。 */
  wpm: number;
  /** 语速评价：太慢/适中/太快。 */
  pacing: "slow" | "on-pace" | "fast";
  /** filler words（um/uh/like/你懂的…）及次数。 */
  fillerWords: Array<{ word: string; count: number }>;
  /** 清晰度 0-100。 */
  clarity: number;
  feedback: string;
}
