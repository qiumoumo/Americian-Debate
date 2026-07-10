import type { FlowSuggestionCategory } from "@debate/shared";

export interface GeneratedMatchNotesShape {
  ourCase: Array<{
    speech: string;
    argument: string;
    evidenceIds: string[];
    suggestedText: string;
  }>;
  frontlines: Array<{
    opponentArgument: string;
    response: string;
    evidenceIds: string[];
  }>;
  risks: string[];
}

export const generatedMatchNotesJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ourCase: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          speech: { type: "string" },
          argument: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
          suggestedText: { type: "string" }
        },
        required: ["speech", "argument", "evidenceIds", "suggestedText"]
      }
    },
    frontlines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          opponentArgument: { type: "string" },
          response: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } }
        },
        required: ["opponentArgument", "response", "evidenceIds"]
      }
    },
    risks: { type: "array", items: { type: "string" } }
  },
  required: ["ourCase", "frontlines", "risks"]
} as const;

const MAX_MATCH_NOTE_ROWS = 8;
const MAX_RISKS = 8;
const MAX_EVIDENCE_IDS = 12;
const MAX_SHORT_TEXT = 180;
const MAX_LONG_TEXT = 1200;
const MAX_FEEDBACK_TEXT = 1400;
const MAX_FEEDBACK_LIST_ITEMS = 6;
const MAX_FEEDBACK_ITEM_TEXT = 220;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function limitText(value: string, maxLength: number) {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function readString(value: unknown, fallback = "", maxLength = MAX_LONG_TEXT) {
  return typeof value === "string" ? limitText(value, maxLength) : fallback;
}

function readStringArray(value: unknown, maxItems = MAX_FEEDBACK_LIST_ITEMS, maxItemLength = MAX_FEEDBACK_ITEM_TEXT) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => limitText(item, maxItemLength))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
}

export function normalizeGeneratedMatchNotes(value: unknown, allowedEvidenceIds: string[] = []): GeneratedMatchNotesShape {
  if (!isObject(value)) {
    throw new Error("AI response is not an object");
  }

  const allowed = new Set(allowedEvidenceIds);
  const filterEvidenceIds = (ids: unknown) => {
    const parsed = readStringArray(ids, MAX_EVIDENCE_IDS, MAX_SHORT_TEXT);
    return allowed.size ? parsed.filter((id) => allowed.has(id)) : parsed;
  };

  const ourCase = Array.isArray(value.ourCase)
    ? value.ourCase.slice(0, MAX_MATCH_NOTE_ROWS).map((item) => {
        if (!isObject(item)) {
          return null;
        }
        return {
          speech: readString(item.speech, "Speech", MAX_SHORT_TEXT),
          argument: readString(item.argument, "Argument", MAX_LONG_TEXT),
          evidenceIds: filterEvidenceIds(item.evidenceIds),
          suggestedText: readString(item.suggestedText, "", MAX_LONG_TEXT)
        };
      }).filter((item): item is GeneratedMatchNotesShape["ourCase"][number] => item !== null && Boolean(item.suggestedText || item.argument))
    : [];

  const frontlines = Array.isArray(value.frontlines)
    ? value.frontlines.slice(0, MAX_MATCH_NOTE_ROWS).map((item) => {
        if (!isObject(item)) {
          return null;
        }
        return {
          opponentArgument: readString(item.opponentArgument, "Opponent argument", MAX_LONG_TEXT),
          response: readString(item.response, "", MAX_LONG_TEXT),
          evidenceIds: filterEvidenceIds(item.evidenceIds)
        };
      }).filter((item): item is GeneratedMatchNotesShape["frontlines"][number] => item !== null && Boolean(item.response))
    : [];

  return {
    ourCase,
    frontlines,
    risks: readStringArray(value.risks, MAX_RISKS, MAX_LONG_TEXT)
  };
}

export type PracticeRubricDimension =
  | "clash"
  | "evidenceExtension"
  | "weighing"
  | "collapse"
  | "lineByLineEfficiency";

export const practiceRubricDimensions: PracticeRubricDimension[] = [
  "clash",
  "evidenceExtension",
  "weighing",
  "collapse",
  "lineByLineEfficiency"
];

export interface RubricScore {
  score: number;
  comment: string;
}

export interface PracticeFeedbackShape {
  score: number;
  feedback: string;
  rubric: Record<PracticeRubricDimension, RubricScore>;
  strengths: string[];
  weaknesses: string[];
  nextDrills: string[];
}

const rubricDimensionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    comment: { type: "string" }
  },
  required: ["score", "comment"]
} as const;

export const practiceFeedbackJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    feedback: { type: "string" },
    rubric: {
      type: "object",
      additionalProperties: false,
      properties: {
        clash: rubricDimensionSchema,
        evidenceExtension: rubricDimensionSchema,
        weighing: rubricDimensionSchema,
        collapse: rubricDimensionSchema,
        lineByLineEfficiency: rubricDimensionSchema
      },
      required: ["clash", "evidenceExtension", "weighing", "collapse", "lineByLineEfficiency"]
    },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    nextDrills: { type: "array", items: { type: "string" } }
  },
  required: ["score", "feedback", "rubric", "strengths", "weaknesses", "nextDrills"]
} as const;

function clampScore(value: unknown, fallback = 70) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}

function readRubricDimension(value: unknown): RubricScore {
  if (!isObject(value)) {
    return { score: 70, comment: "" };
  }
  return {
    score: clampScore(value.score),
    comment: readString(value.comment, "", MAX_FEEDBACK_ITEM_TEXT)
  };
}

export function normalizePracticeFeedback(value: unknown): PracticeFeedbackShape {
  if (!isObject(value)) {
    throw new Error("AI response is not an object");
  }

  // rubric 缺失（旧行或未返回）时合成中性 rubric，保证 UI 与历史展示不崩。
  const rawRubric = isObject(value.rubric) ? value.rubric : {};
  const rubric = practiceRubricDimensions.reduce((acc, dimension) => {
    acc[dimension] = readRubricDimension((rawRubric as Record<string, unknown>)[dimension]);
    return acc;
  }, {} as Record<PracticeRubricDimension, RubricScore>);

  // 顶层 score 缺失时用五维均值推导，保 getPracticeSummaries 向后兼容。
  const hasTopLevelScore = Number.isFinite(Number(value.score));
  const rubricMean =
    practiceRubricDimensions.reduce((sum, dimension) => sum + rubric[dimension].score, 0) /
    practiceRubricDimensions.length;
  const score = hasTopLevelScore ? clampScore(value.score) : Math.round(rubricMean);

  return {
    score,
    feedback: readString(value.feedback, "Keep practicing and add clearer weighing.", MAX_FEEDBACK_TEXT),
    rubric,
    strengths: readStringArray(value.strengths),
    weaknesses: readStringArray(value.weaknesses),
    nextDrills: readStringArray(value.nextDrills)
  };
}

// ── Practice drills ──────────────────────────────────────────────

export type PracticeDrillDimension = PracticeRubricDimension | "general";

export interface PracticeDrill {
  title: string;
  instructions: string;
  targetDimension: PracticeDrillDimension;
  durationSeconds: number;
  promptText: string;
}

export interface PracticeDrillsShape {
  drills: PracticeDrill[];
}

const MAX_DRILLS = 6;
const MIN_DRILL_SECONDS = 15;
const MAX_DRILL_SECONDS = 600;

export const practiceDrillsJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    drills: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          instructions: { type: "string" },
          targetDimension: {
            type: "string",
            enum: ["clash", "evidenceExtension", "weighing", "collapse", "lineByLineEfficiency", "general"]
          },
          durationSeconds: { type: "number" },
          promptText: { type: "string" }
        },
        required: ["title", "instructions", "targetDimension", "durationSeconds", "promptText"]
      }
    }
  },
  required: ["drills"]
} as const;

function readDrillDimension(value: unknown): PracticeDrillDimension {
  return typeof value === "string" && (["general", ...practiceRubricDimensions] as string[]).includes(value)
    ? (value as PracticeDrillDimension)
    : "general";
}

export function normalizePracticeDrills(value: unknown): PracticeDrillsShape {
  if (!isObject(value)) {
    throw new Error("AI response is not an object");
  }

  const drills = Array.isArray(value.drills)
    ? value.drills
        .slice(0, MAX_DRILLS)
        .map((item) => {
          if (!isObject(item)) {
            return null;
          }
          const rawSeconds = Number(item.durationSeconds);
          const durationSeconds = Number.isFinite(rawSeconds)
            ? Math.max(MIN_DRILL_SECONDS, Math.min(MAX_DRILL_SECONDS, Math.round(rawSeconds)))
            : 30;
          return {
            title: readString(item.title, "Drill", MAX_SHORT_TEXT),
            instructions: readString(item.instructions, "", MAX_LONG_TEXT),
            targetDimension: readDrillDimension(item.targetDimension),
            durationSeconds,
            promptText: readString(item.promptText, "", MAX_LONG_TEXT)
          };
        })
        .filter((item): item is PracticeDrill => item !== null && Boolean(item.title || item.promptText))
    : [];

  return { drills };
}

export interface FlowRebuttalResponse {
  label: string;
  category: FlowSuggestionCategory;
  response: string;
  strategy: string;
  evidenceIds: string[];
}

export interface FlowRebuttalSuggestionsShape {
  responses: FlowRebuttalResponse[];
  weighing: string[];
}

const MAX_FLOW_RESPONSES = 8;

export const flowRebuttalSuggestionsJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    responses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          category: { type: "string", enum: ["answer", "turn", "weigh", "collapse"] },
          response: { type: "string" },
          strategy: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } }
        },
        required: ["label", "category", "response", "strategy", "evidenceIds"]
      }
    },
    weighing: { type: "array", items: { type: "string" } }
  },
  required: ["responses", "weighing"]
} as const;

function readFlowCategory(value: unknown): FlowSuggestionCategory {
  return value === "turn" || value === "weigh" || value === "collapse" ? value : "answer";
}

export function normalizeFlowRebuttalSuggestions(value: unknown, allowedEvidenceIds: string[] = []): FlowRebuttalSuggestionsShape {
  if (!isObject(value)) {
    throw new Error("AI response is not an object");
  }

  const allowed = new Set(allowedEvidenceIds);
  const filterEvidenceIds = (ids: unknown) => {
    const parsed = readStringArray(ids, MAX_EVIDENCE_IDS, MAX_SHORT_TEXT);
    return allowed.size ? parsed.filter((id) => allowed.has(id)) : parsed;
  };

  const responses = Array.isArray(value.responses)
    ? value.responses.slice(0, MAX_FLOW_RESPONSES).map((item) => {
        if (!isObject(item)) {
          return null;
        }
        return {
          label: readString(item.label, "Response", MAX_SHORT_TEXT),
          category: readFlowCategory(item.category),
          response: readString(item.response, "", MAX_LONG_TEXT),
          strategy: readString(item.strategy, "", MAX_SHORT_TEXT),
          evidenceIds: filterEvidenceIds(item.evidenceIds)
        };
      }).filter((item): item is FlowRebuttalResponse => item !== null && Boolean(item.response))
    : [];

  return {
    responses,
    weighing: readStringArray(value.weighing, MAX_FEEDBACK_LIST_ITEMS, MAX_LONG_TEXT)
  };
}
