export * from "./evidence.ts";

export type Side = "Aff" | "Neg" | "Pro" | "Con" | "Generic";
export type DebateFormat = "PF" | "LD" | "Policy" | "BP" | "Custom";
export type MatchResult = "win" | "loss" | "pending";
export type ArgumentOutcome = "won" | "lost" | "dropped" | "turned" | "conceded";

export interface Evidence {
  id: string;
  documentId: string;
  title: string;
  claim: string;
  quote: string;
  sourceUrl: string;
  author?: string;
  publication?: string;
  publishedDate?: string;
  side: Side;
  tags: string[];
}

export interface DebateDocument {
  id: string;
  title: string;
  description: string;
  contentText?: string;
  updatedAt: string;
  evidence: Evidence[];
  permissions: Array<"owner" | "editor" | "viewer">;
}

export interface SpeechTemplateRow {
  speech: string;
  focus: string;
  evidenceIds: string[];
  opponentFlowPrompt: string;
}

export interface MatchRecord {
  id: string;
  tournament: string;
  opponent: string;
  topic: string;
  format: DebateFormat;
  side: Side;
  result: MatchResult;
  tags: string[];
  reflection: string;
  argumentOutcomes: Array<{
    id?: string;
    argument: string;
    side: Side;
    outcome: ArgumentOutcome;
  }>;
}

export interface RoundVideoNote {
  id: string;
  timestampSeconds: number | null;
  body: string;
  createdAt: string;
}

export interface LibraryRoundRecord {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  topic: string;
  format: DebateFormat;
  teams: string;
  year: string;
  tournament: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  notes: RoundVideoNote[]; // 仅当前用户的笔记
}

export interface PracticeSessionSummary {
  id: string;
  topic: string;
  format: DebateFormat;
  side: Side;
  mode: string;
  score: number;
  feedback: string;
  createdAt: string;
  turns: number;
}

export type FlowCellStatus = "open" | "extended" | "answered" | "dropped" | "turned" | "conceded";

/** Line-by-line response 的类型。generic "response" 用于手动条目；其余四类对齐 AI 建议分类。 */
export type FlowResponseKind = "response" | "answer" | "turn" | "weigh" | "collapse";

/** AI 反驳面板的四类建议（不含 generic "response"）。 */
export type FlowSuggestionCategory = "answer" | "turn" | "weigh" | "collapse";

export const flowSuggestionCategories: FlowSuggestionCategory[] = ["answer", "turn", "weigh", "collapse"];

export interface FlowColumn {
  speechType: string;
  speechOrder: number;
  label: string;
}

/** 一个 cell 下的一条离散 response（line-by-line 链的一环）。 */
export interface FlowResponse {
  id: string;
  order: number;
  side: Side;
  kind: FlowResponseKind;
  content: string;
  evidenceIds: string[];
  status: FlowCellStatus;
}

export interface FlowCell {
  id: string;
  speechType: string;
  speechOrder: number;
  content: string;
  evidenceIds: string[];
  status: FlowCellStatus;
  responses: FlowResponse[];
}

/** per-argument 的 weighing 四要素。空串表示未填写。 */
export interface FlowWeighing {
  magnitude: string;
  probability: string;
  timeframe: string;
  scope: string;
}

export interface FlowRow {
  id: string;
  matchId: string;
  side: Side;
  title: string;
  category: string;
  order: number;
  weighing: FlowWeighing;
  cells: FlowCell[];
}

export const debateFormats = [
  { id: "PF", name: "Public Forum", speechPreset: "Constructive / Rebuttal / Summary / Final Focus" },
  { id: "LD", name: "Lincoln-Douglas", speechPreset: "AC / NC / 1AR / NR / 2AR" },
  { id: "Policy", name: "Policy", speechPreset: "1AC / 1NC / 2AC / 2NC / 1NR / 1AR / 2NR / 2AR" },
  { id: "BP", name: "British Parliamentary", speechPreset: "PM / LO / DPM / DLO / Member / Whip" }
] as const;

export interface SpeechPreset {
  speech: string;
  durationMs: number;
}

// ── NSDA 赛制引擎：统一 format-config ─────────────────────────────
// speech 序列（含 crossfire）、per-side prep、side labels、预置 flow 行模板，
// 全部由 formatConfigs 定义。speechPresets / prepTimeByFormat 由它派生（向后兼容）。

export type SpeechKind = "speech" | "crossfire" | "prep";

/** 计时序列中的一段（正式发言或 crossfire）。speechOrder = 在序列中的 index + 1。 */
export interface FormatSpeech {
  speech: string; // "1AC" / "Crossfire" / "Grand Crossfire"
  durationMs: number;
  kind: SpeechKind; // crossfire 段 => "crossfire"
  flowable: boolean; // crossfire => false，派生 flow 列时排除
  side: Side; // 发言方；共享 crossfire 用 "Generic"
  shortLabel?: string; // 可选紧凑列头
}

/** 创建 round 时自动预置的 flow 行（LD 的 Value/Criterion/Framework、Policy 的 off-case 等）。 */
export interface FlowRowTemplate {
  title: string;
  category: string; // "framework" | "case" | "offcase" | "general"
  side: Side;
}

export interface FormatConfig {
  id: DebateFormat;
  name: string;
  /** 有序的可计时段（正式发言 + crossfire），speechOrder = index + 1。 */
  speeches: FormatSpeech[];
  /** 每方 prep 预算（毫秒）。键是该赛制的两个立场。 */
  prepBySide: Partial<Record<Side, number>>;
  /** 该赛制两个立场的标签（PF 用 Pro/Con，LD/Policy 用 Aff/Neg）。 */
  sideLabels: { first: Side; second: Side };
  /** 创建 round 时自动建的 flow 行；空数组表示用户手动搭建。 */
  defaultFlowRows: FlowRowTemplate[];
}

export const formatConfigs: Record<DebateFormat, FormatConfig> = {
  PF: {
    id: "PF",
    name: "Public Forum",
    sideLabels: { first: "Pro", second: "Con" },
    prepBySide: { Pro: 180000, Con: 180000 }, // 各 3 分钟
    speeches: [
      { speech: "Pro Constructive", durationMs: 240000, kind: "speech", flowable: true, side: "Pro", shortLabel: "Pro Const" },
      { speech: "Con Constructive", durationMs: 240000, kind: "speech", flowable: true, side: "Con", shortLabel: "Con Const" },
      { speech: "Crossfire", durationMs: 180000, kind: "crossfire", flowable: false, side: "Generic" },
      { speech: "Pro Rebuttal", durationMs: 240000, kind: "speech", flowable: true, side: "Pro", shortLabel: "Pro Reb" },
      { speech: "Con Rebuttal", durationMs: 240000, kind: "speech", flowable: true, side: "Con", shortLabel: "Con Reb" },
      { speech: "Crossfire", durationMs: 180000, kind: "crossfire", flowable: false, side: "Generic" },
      { speech: "Pro Summary", durationMs: 180000, kind: "speech", flowable: true, side: "Pro", shortLabel: "Pro Sum" },
      { speech: "Con Summary", durationMs: 180000, kind: "speech", flowable: true, side: "Con", shortLabel: "Con Sum" },
      { speech: "Grand Crossfire", durationMs: 180000, kind: "crossfire", flowable: false, side: "Generic" },
      { speech: "Pro Final Focus", durationMs: 120000, kind: "speech", flowable: true, side: "Pro", shortLabel: "Pro FF" },
      { speech: "Con Final Focus", durationMs: 120000, kind: "speech", flowable: true, side: "Con", shortLabel: "Con FF" }
    ],
    defaultFlowRows: [] // PF：现场建 contention 行
  },
  LD: {
    id: "LD",
    name: "Lincoln-Douglas",
    sideLabels: { first: "Aff", second: "Neg" },
    prepBySide: { Aff: 240000, Neg: 240000 }, // 各 4 分钟
    speeches: [
      { speech: "1AC", durationMs: 360000, kind: "speech", flowable: true, side: "Aff" },
      { speech: "CX (Neg asks Aff)", durationMs: 180000, kind: "crossfire", flowable: false, side: "Generic" },
      { speech: "1NC", durationMs: 420000, kind: "speech", flowable: true, side: "Neg" },
      { speech: "CX (Aff asks Neg)", durationMs: 180000, kind: "crossfire", flowable: false, side: "Generic" },
      { speech: "1AR", durationMs: 240000, kind: "speech", flowable: true, side: "Aff" },
      { speech: "NR", durationMs: 360000, kind: "speech", flowable: true, side: "Neg" },
      { speech: "2AR", durationMs: 180000, kind: "speech", flowable: true, side: "Aff" }
    ],
    defaultFlowRows: [
      { title: "Value", category: "framework", side: "Generic" },
      { title: "Criterion / Value Criterion", category: "framework", side: "Generic" },
      { title: "Framework", category: "framework", side: "Generic" }
    ]
  },
  Policy: {
    id: "Policy",
    name: "Policy (CX)",
    sideLabels: { first: "Aff", second: "Neg" },
    prepBySide: { Aff: 480000, Neg: 480000 }, // 各 8 分钟
    speeches: [
      { speech: "1AC", durationMs: 480000, kind: "speech", flowable: true, side: "Aff" },
      { speech: "CX of 1AC (2N)", durationMs: 180000, kind: "crossfire", flowable: false, side: "Generic" },
      { speech: "1NC", durationMs: 480000, kind: "speech", flowable: true, side: "Neg" },
      { speech: "CX of 1NC (1A)", durationMs: 180000, kind: "crossfire", flowable: false, side: "Generic" },
      { speech: "2AC", durationMs: 480000, kind: "speech", flowable: true, side: "Aff" },
      { speech: "CX of 2AC (1N)", durationMs: 180000, kind: "crossfire", flowable: false, side: "Generic" },
      { speech: "2NC", durationMs: 480000, kind: "speech", flowable: true, side: "Neg" },
      { speech: "CX of 2NC (2A)", durationMs: 180000, kind: "crossfire", flowable: false, side: "Generic" },
      { speech: "1NR", durationMs: 300000, kind: "speech", flowable: true, side: "Neg" },
      { speech: "1AR", durationMs: 300000, kind: "speech", flowable: true, side: "Aff" },
      { speech: "2NR", durationMs: 300000, kind: "speech", flowable: true, side: "Neg" },
      { speech: "2AR", durationMs: 300000, kind: "speech", flowable: true, side: "Aff" }
    ],
    defaultFlowRows: [
      { title: "Case (Advantages)", category: "case", side: "Aff" },
      { title: "Solvency", category: "case", side: "Aff" },
      { title: "Topicality", category: "offcase", side: "Neg" },
      { title: "Disadvantage (DA)", category: "offcase", side: "Neg" },
      { title: "Counterplan (CP)", category: "offcase", side: "Neg" },
      { title: "Kritik (K)", category: "offcase", side: "Neg" }
    ]
  },
  BP: {
    id: "BP",
    name: "British Parliamentary",
    sideLabels: { first: "Aff", second: "Neg" },
    prepBySide: {}, // BP prep 在赛前，不上表计时
    speeches: [
      { speech: "PM", durationMs: 420000, kind: "speech", flowable: true, side: "Aff" },
      { speech: "LO", durationMs: 420000, kind: "speech", flowable: true, side: "Neg" },
      { speech: "DPM", durationMs: 420000, kind: "speech", flowable: true, side: "Aff" },
      { speech: "DLO", durationMs: 420000, kind: "speech", flowable: true, side: "Neg" },
      { speech: "Member", durationMs: 420000, kind: "speech", flowable: true, side: "Generic" },
      { speech: "Whip", durationMs: 420000, kind: "speech", flowable: true, side: "Generic" }
    ],
    defaultFlowRows: []
  },
  Custom: {
    id: "Custom",
    name: "Custom",
    sideLabels: { first: "Aff", second: "Neg" },
    prepBySide: { Aff: 180000, Neg: 180000 },
    speeches: [
      { speech: "Speech 1", durationMs: 240000, kind: "speech", flowable: true, side: "Aff" },
      { speech: "Speech 2", durationMs: 240000, kind: "speech", flowable: true, side: "Neg" },
      { speech: "Speech 3", durationMs: 180000, kind: "speech", flowable: true, side: "Aff" },
      { speech: "Speech 4", durationMs: 120000, kind: "speech", flowable: true, side: "Neg" }
    ],
    defaultFlowRows: []
  }
};

// ── Practice：模式、AI 人格、round-state ─────────────────────────
// PracticeMode 的唯一来源（practice.ts 与路由都从这里导入，避免分叉 union）。

export type PracticeMode = "text-spar" | "speech-drill" | "crossfire" | "rebuttal-drill" | "weighing-drill";

export const practiceModes: PracticeMode[] = [
  "text-spar",
  "speech-drill",
  "crossfire",
  "rebuttal-drill",
  "weighing-drill"
];

export const practiceModeLabels: Record<PracticeMode, { zh: string; en: string }> = {
  "text-spar": { zh: "文字对辩", en: "Text spar" },
  "speech-drill": { zh: "整段发言训练", en: "Speech drill" },
  crossfire: { zh: "质询对抗", en: "Crossfire" },
  "rebuttal-drill": { zh: "反驳训练", en: "Rebuttal drill" },
  "weighing-drill": { zh: "权衡训练", en: "Weighing drill" }
};

export function isPracticeMode(value: unknown): value is PracticeMode {
  return typeof value === "string" && (practiceModes as string[]).includes(value);
}

export type AiPersona = "lay-judge" | "flow-judge" | "technical-opponent" | "aggressive-cx";

export const aiPersonas: AiPersona[] = ["lay-judge", "flow-judge", "technical-opponent", "aggressive-cx"];

export const aiPersonaLabels: Record<AiPersona, { zh: string; en: string }> = {
  "lay-judge": { zh: "平民评委", en: "Lay judge" },
  "flow-judge": { zh: "流程评委", en: "Flow judge" },
  "technical-opponent": { zh: "技术型对手", en: "Technical opponent" },
  "aggressive-cx": { zh: "激进质询对手", en: "Aggressive crossfire" }
};

/** 每个人格注入 prompt 的一句英文指令。 */
export const aiPersonaDirectives: Record<AiPersona, string> = {
  "lay-judge":
    "Judge and argue as a persuadable non-expert: reward clear real-world impact and plain language; penalize jargon, acronyms, and blippy under-explained analysis.",
  "flow-judge":
    "Judge and argue as a technical flow judge: track every argument line-by-line, punish dropped responses, and reward clean extensions and explicit comparison.",
  "technical-opponent":
    "Argue as a skilled technical opponent: pressure weak links, exploit dropped arguments, and force judge-ready comparative weighing.",
  "aggressive-cx":
    "Argue as an aggressive crossfire opponent: ask fast, pointed, cornering questions, interrupt evasions, and refuse to let the debater dodge; keep the pressure relentless but fair."
};

export function isAiPersona(value: unknown): value is AiPersona {
  return typeof value === "string" && (aiPersonas as string[]).includes(value);
}

export interface PracticeRoundState {
  /** 用户即将进行的发言；drills/crossfire 下为对应的固定段。 */
  currentSpeech: FormatSpeech | null;
  /** currentSpeech 在 formatConfigs.speeches 中的 index（-1 表示无）。 */
  currentSpeechIndex: number;
  /** 当前发言方（crossfire 段为 "Generic"）。 */
  currentSide: Side;
  /** 与用户发言交错的对方发言。 */
  opponentSpeech: FormatSpeech | null;
  /** 用户下一段发言（若还有）。 */
  nextSpeech: FormatSpeech | null;
  /** 是否轮到用户发言。 */
  userSpeaksNext: boolean;
  /** 人读阶段标签，如 "LD · 1AR（你的第 2 次发言）"。 */
  phaseLabel: string;
  /** 用户已走完全部发言。 */
  isComplete: boolean;
  /** 用户方在该赛制的可发言总数。 */
  totalUserSpeeches: number;
}

export interface PracticeRoundStateInput {
  format: DebateFormat;
  side: Side;
  /** 用户已发言的轮数（transcript 里 role==="user" 的条数）。 */
  userTurns: number;
  mode: PracticeMode;
}

/**
 * 把用户声明的 side 映射到该赛制的 first/second，避免 PF(Pro/Con) 与
 * LD/Policy(Aff/Neg) 字符串不等。Generic 无法定位则返回 null。
 */
function resolveUserSide(config: FormatConfig, side: Side): Side | null {
  const { first, second } = config.sideLabels;
  if (side === first || side === second) {
    return side;
  }
  // Pro/Con ↔ Aff/Neg 的跨赛制别名：first=进攻方/正方，second=防守方/反方。
  const firstAliases: Side[] = ["Aff", "Pro"];
  const secondAliases: Side[] = ["Neg", "Con"];
  if (firstAliases.includes(side)) {
    return first;
  }
  if (secondAliases.includes(side)) {
    return second;
  }
  return null;
}

function speechMatchesSide(speech: FormatSpeech, side: Side) {
  return speech.side === side;
}

/**
 * 从赛制发言序列 + 用户已发言轮数推出当前 round 状态。纯函数、无副作用。
 * crossfire / *-drill 特判为固定段，不做线性推进（见 plan 棘手点 1）。
 */
export function getPracticeRoundState(input: PracticeRoundStateInput): PracticeRoundState {
  const config = formatConfigs[input.format];
  const speeches = config.speeches;
  const userTurns = Number.isFinite(input.userTurns) && input.userTurns > 0 ? Math.floor(input.userTurns) : 0;
  const userSide = resolveUserSide(config, input.side);

  const indexOf = (speech: FormatSpeech | null) => (speech ? speeches.indexOf(speech) : -1);
  const formatName = config.name;

  // crossfire：解析到最近的 crossfire 段，不随发言线性推进。
  if (input.mode === "crossfire") {
    const cx = speeches.find((speech) => speech.kind === "crossfire") ?? null;
    return {
      currentSpeech: cx,
      currentSpeechIndex: indexOf(cx),
      currentSide: "Generic",
      opponentSpeech: null,
      nextSpeech: null,
      userSpeaksNext: true,
      phaseLabel: `${formatName} · ${cx ? cx.speech : "Crossfire"}（质询对抗）`,
      isComplete: false,
      totalUserSpeeches: 0
    };
  }

  // 用户方 / 对方的 flowable 正式发言序列。
  const flowableSpeeches = speeches.filter((speech) => speech.kind === "speech" && speech.flowable);
  const userSpeeches = userSide
    ? flowableSpeeches.filter((speech) => speechMatchesSide(speech, userSide))
    : flowableSpeeches; // Generic：回退为全部发言的简单遍历
  const opponentSide = userSide
    ? userSide === config.sideLabels.first
      ? config.sideLabels.second
      : config.sideLabels.first
    : null;
  const opponentSpeeches = opponentSide
    ? flowableSpeeches.filter((speech) => speechMatchesSide(speech, opponentSide))
    : [];

  // rebuttal-drill / weighing-drill：钉在对应类别的发言上（固定阶段）。
  if (input.mode === "rebuttal-drill" || input.mode === "weighing-drill") {
    const isRebuttalDrill = input.mode === "rebuttal-drill";
    const keyword = isRebuttalDrill ? /rebuttal|1ar|1nr|1nc|2ac/i : /summary|final|2ar|2nr/i;
    const pinned = userSpeeches.find((speech) => keyword.test(speech.speech)) ?? userSpeeches[userSpeeches.length - 1] ?? null;
    const drillLabel = isRebuttalDrill ? "反驳训练" : "权衡训练";
    return {
      currentSpeech: pinned,
      currentSpeechIndex: indexOf(pinned),
      currentSide: userSide ?? "Generic",
      opponentSpeech: opponentSpeeches[0] ?? null,
      nextSpeech: null,
      userSpeaksNext: true,
      phaseLabel: `${formatName} · ${pinned ? pinned.speech : drillLabel}（${drillLabel}）`,
      isComplete: false,
      totalUserSpeeches: userSpeeches.length
    };
  }

  // text-spar / speech-drill：按 userTurns 线性推进用户方发言。
  const totalUserSpeeches = userSpeeches.length;
  const isComplete = totalUserSpeeches > 0 && userTurns >= totalUserSpeeches;
  const currentSpeech = isComplete ? null : userSpeeches[userTurns] ?? userSpeeches[totalUserSpeeches - 1] ?? null;
  const nextSpeech = isComplete ? null : userSpeeches[userTurns + 1] ?? null;
  const opponentSpeech = opponentSpeeches[userTurns] ?? opponentSpeeches[opponentSpeeches.length - 1] ?? null;

  const turnOrdinal = Math.min(userTurns + 1, totalUserSpeeches || userTurns + 1);
  const phaseLabel = currentSpeech
    ? `${formatName} · ${currentSpeech.speech}（你的第 ${turnOrdinal} 次发言）`
    : `${formatName} · 已完成全部发言`;

  return {
    currentSpeech,
    currentSpeechIndex: indexOf(currentSpeech),
    currentSide: currentSpeech ? currentSpeech.side : userSide ?? "Generic",
    opponentSpeech,
    nextSpeech,
    userSpeaksNext: !isComplete,
    phaseLabel,
    isComplete,
    totalUserSpeeches
  };
}

const ALL_FORMATS: DebateFormat[] = ["PF", "LD", "Policy", "BP", "Custom"];

// 各赛制的标准发言时长（毫秒）。由 formatConfigs 派生，含 crossfire 段。
// server action 与 SpeechTimer 共用，避免重复定义。
export const speechPresets: Record<DebateFormat, SpeechPreset[]> = Object.fromEntries(
  ALL_FORMATS.map((format) => [
    format,
    formatConfigs[format].speeches.map((speech) => ({ speech: speech.speech, durationMs: speech.durationMs }))
  ])
) as Record<DebateFormat, SpeechPreset[]>;

// 各赛制标准 prep time（毫秒）。向后兼容：取第一方的预算（无则 0）。
// 新代码请用 formatConfigs[format].prepBySide 获取 per-side 预算。
export const prepTimeByFormat: Record<DebateFormat, number> = Object.fromEntries(
  ALL_FORMATS.map((format) => {
    const budgets = Object.values(formatConfigs[format].prepBySide);
    return [format, budgets[0] ?? 0];
  })
) as Record<DebateFormat, number>;

// 集中化的赛制下拉选项，替换各处硬编码的 <option> 列表。
export const formatOptions: Array<{ id: DebateFormat; name: string }> = ALL_FORMATS.map((id) => ({
  id,
  name: formatConfigs[id].name
}));

// 素材库 round 的推荐标签词表（可自由输入，UI 仅作为快捷建议）。
export const suggestedRoundTags = [
  "PF", "LD", "Policy", "framework", "crossfire", "weighing",
  "final focus", "rebuttal", "signposting", "impact calc", "clash", "collapse"
] as const;

export const workspaceStats = {
  rounds: 18,
  winRate: 64,
  affWinRate: 68,
  negWinRate: 59,
  evidenceCards: 142,
  unresolvedSources: 7
};

export const sampleDocuments: DebateDocument[] = [
  {
    id: "doc-immigration-econ",
    title: "Immigration Econ Core File",
    description: "Economic growth, labor supply, and local fiscal impact evidence.",
    updatedAt: "2026-07-02",
    permissions: ["owner", "editor"],
    evidence: [
      {
        id: "ev-labor-01",
        documentId: "doc-immigration-econ",
        title: "Immigration expands labor supply",
        claim: "High-skill and low-skill immigration can raise productivity by complementing native workers.",
        quote: "Immigrant labor often complements rather than substitutes native labor, expanding output and specialization.",
        sourceUrl: "https://example.org/labor-supply",
        author: "National Academies",
        publication: "Economic Effects Report",
        publishedDate: "2025",
        side: "Aff",
        tags: ["economy", "labor", "growth"]
      },
      {
        id: "ev-fiscal-02",
        documentId: "doc-immigration-econ",
        title: "Local fiscal stress answers",
        claim: "Fiscal impacts vary by jurisdiction and are strongest where integration funding is absent.",
        quote: "Short-run costs concentrate locally, but long-run tax contributions rise with labor-market integration.",
        sourceUrl: "https://example.org/fiscal-impact",
        author: "Urban Institute",
        publication: "Migration Policy Brief",
        publishedDate: "2026",
        side: "Neg",
        tags: ["fiscal", "local", "answers"]
      }
    ]
  },
  {
    id: "doc-ai-regulation",
    title: "AI Regulation Blocks",
    description: "Safety, innovation, compute governance, and international competition blocks.",
    updatedAt: "2026-06-29",
    permissions: ["viewer"],
    evidence: [
      {
        id: "ev-safety-03",
        documentId: "doc-ai-regulation",
        title: "Safety standards reduce catastrophic risk",
        claim: "Mandatory evaluations create common baselines without banning development.",
        quote: "Evaluation regimes can reveal dangerous capabilities before public deployment.",
        sourceUrl: "https://example.org/ai-safety-evals",
        author: "Frontier Safety Forum",
        publication: "AI Governance Note",
        publishedDate: "2026",
        side: "Aff",
        tags: ["ai", "safety", "standards"]
      }
    ]
  }
];

export const defaultSpeechTemplate: SpeechTemplateRow[] = [
  {
    speech: "Constructive",
    focus: "Read case and establish weighing.",
    evidenceIds: ["ev-labor-01"],
    opponentFlowPrompt: "Track their framework, contentions, and first-line responses."
  },
  {
    speech: "Rebuttal",
    focus: "Frontline turns and answer their offense.",
    evidenceIds: ["ev-fiscal-02"],
    opponentFlowPrompt: "Mark which answers are extended and which evidence they cite."
  },
  {
    speech: "Summary",
    focus: "Collapse to the cleanest offense and rebuild weighing.",
    evidenceIds: ["ev-labor-01"],
    opponentFlowPrompt: "Circle drops and concessions that matter for final focus."
  },
  {
    speech: "Final Focus",
    focus: "Compare worlds and crystallize ballot story.",
    evidenceIds: [],
    opponentFlowPrompt: "Write judge-ready voting issues and last responses."
  }
];

export const sampleMatches: MatchRecord[] = [
  {
    id: "match-1",
    tournament: "Local Scrimmage",
    opponent: "Northview AB",
    topic: "Immigration and labor markets",
    format: "PF",
    side: "Aff",
    result: "win",
    tags: ["economy", "weighing"],
    reflection: "We won on comparative labor market weighing, but summary needed cleaner collapse.",
    argumentOutcomes: [
      { argument: "Labor complementarity", side: "Aff", outcome: "won" },
      { argument: "Fiscal stress", side: "Neg", outcome: "lost" }
    ]
  },
  {
    id: "match-2",
    tournament: "Practice Round",
    opponent: "East Prep",
    topic: "AI regulation",
    format: "LD",
    side: "Neg",
    result: "loss",
    tags: ["ai", "framework"],
    reflection: "Dropped their standards overview; need a clearer pre-written framework block.",
    argumentOutcomes: [
      { argument: "Innovation tradeoff", side: "Neg", outcome: "dropped" },
      { argument: "Safety standards", side: "Aff", outcome: "won" }
    ]
  }
];

export const practiceSummaries: PracticeSessionSummary[] = [
  {
    id: "practice-1",
    topic: "AI safety regulation",
    format: "LD",
    side: "Neg",
    mode: "text-spar",
    score: 82,
    feedback: "Good clash on standards. Add clearer weighing before the last rebuttal.",
    createdAt: "2025-01-01T00:00:00.000Z",
    turns: 6
  },
  {
    id: "practice-2",
    topic: "Immigration economics",
    format: "PF",
    side: "Aff",
    mode: "text-spar",
    score: 76,
    feedback: "Evidence use was strong, but final focus repeated rather than compared.",
    createdAt: "2025-01-01T00:00:00.000Z",
    turns: 4
  }
];
