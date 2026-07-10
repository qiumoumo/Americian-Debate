import type { Evidence, Side, SpeechTemplateRow } from "@debate/shared";
import { messagesFromPromptBundle, promptBundleToCopyText, type AIProvider, type PromptBundle } from "./index.ts";
import { generatedMatchNotesJsonSchema, normalizeGeneratedMatchNotes, type GeneratedMatchNotesShape } from "./schemas.ts";

export interface GenerateMatchNotesInput {
  provider: AIProvider;
  side: Side;
  speechEvidence: Evidence[];
  opponentContext?: string;
}

export type GeneratedMatchNotes = GeneratedMatchNotesShape;

export function buildMatchNotesPrompt(input: Omit<GenerateMatchNotesInput, "provider">): PromptBundle {
  return {
    system: [
      "You help competitive debaters prepare match notes.",
      "Return only JSON matching the requested schema.",
      "Only reference evidence IDs included in the user's evidence list.",
      "AI output is a draft; write concise, judge-ready notes that the debater can confirm before insertion."
    ].join(" "),
    user: JSON.stringify({
      side: input.side,
      evidence: input.speechEvidence,
      opponentContext: input.opponentContext ?? "",
      schema: generatedMatchNotesJsonSchema
    }, null, 2)
  };
}

export function buildMatchNotesCopyPrompt(input: Omit<GenerateMatchNotesInput, "provider">) {
  return promptBundleToCopyText(buildMatchNotesPrompt(input));
}

export async function generateMatchNotesDraft(input: GenerateMatchNotesInput): Promise<GeneratedMatchNotes> {
  const allowedEvidenceIds = input.speechEvidence.map((card) => card.id);
  const prompt = buildMatchNotesPrompt(input);
  const raw = await input.provider.generateStructured<unknown>({
    schemaName: "GeneratedMatchNotes",
    schema: generatedMatchNotesJsonSchema,
    messages: messagesFromPromptBundle(prompt)
  });

  return normalizeGeneratedMatchNotes(raw, allowedEvidenceIds);
}

export function createTemplateRowsFromEvidence(evidence: Evidence[]): SpeechTemplateRow[] {
  const affEvidence = evidence.filter((card) => card.side === "Aff" || card.side === "Pro" || card.side === "Generic");
  const negEvidence = evidence.filter((card) => card.side === "Neg" || card.side === "Con" || card.side === "Generic");

  return [
    {
      speech: "Constructive",
      focus: "Read case and establish weighing.",
      evidenceIds: affEvidence.slice(0, 2).map((card) => card.id),
      opponentFlowPrompt: "Track framework, contentions, and first-line responses."
    },
    {
      speech: "Rebuttal",
      focus: "Answer their offense and extend turns.",
      evidenceIds: negEvidence.slice(0, 2).map((card) => card.id),
      opponentFlowPrompt: "Mark which responses are extended, dropped, or conceded."
    },
    {
      speech: "Summary",
      focus: "Collapse to the cleanest offense.",
      evidenceIds: evidence.slice(0, 1).map((card) => card.id),
      opponentFlowPrompt: "Circle drops that should become voting issues."
    },
    {
      speech: "Final Focus",
      focus: "Compare worlds and write the ballot story.",
      evidenceIds: [],
      opponentFlowPrompt: "Write judge-ready voters, weighing, and last answers."
    }
  ];
}
