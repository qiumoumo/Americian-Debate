import type { Evidence, Side } from "@debate/shared";
import { messagesFromPromptBundle, promptBundleToCopyText, type AIProvider, type PromptBundle } from "./index.ts";
import { flowRebuttalSuggestionsJsonSchema, normalizeFlowRebuttalSuggestions, type FlowRebuttalSuggestionsShape } from "./schemas.ts";

export interface GenerateFlowRebuttalInput {
  provider: AIProvider;
  side: Side;
  speechType: string;
  opponentArgument: string;
  evidence: Evidence[];
  flowContext?: string;
}

export type FlowRebuttalSuggestions = FlowRebuttalSuggestionsShape;

export function buildFlowRebuttalPrompt(input: Omit<GenerateFlowRebuttalInput, "provider">): PromptBundle {
  return {
    system: [
      "You help a competitive debater answer an opponent's argument live on the flow.",
      "Return only JSON matching the requested schema.",
      "Classify every response with a category field, one of: 'answer' (直接回应/no-link/delink), 'turn' (link or impact turn that flips their offense), 'weigh' (comparative weighing of magnitude/probability/timeframe/scope), 'collapse' (which single response to go for and extend).",
      "Aim to include at least one 'answer' and, when the argument has offense, at least one 'turn' and one 'weigh'.",
      "Only reference evidence IDs included in the user's evidence list; never invent IDs.",
      "Each response is a draft the debater will confirm before writing on the flow. Be concise and judge-ready."
    ].join(" "),
    user: JSON.stringify({
      side: input.side,
      speechType: input.speechType,
      opponentArgument: input.opponentArgument,
      flowContext: input.flowContext ?? "",
      evidence: input.evidence,
      schema: flowRebuttalSuggestionsJsonSchema
    }, null, 2)
  };
}

export function buildFlowRebuttalCopyPrompt(input: Omit<GenerateFlowRebuttalInput, "provider">) {
  return promptBundleToCopyText(buildFlowRebuttalPrompt(input));
}

export async function generateFlowRebuttalSuggestions(input: GenerateFlowRebuttalInput): Promise<FlowRebuttalSuggestions> {
  const allowedEvidenceIds = input.evidence.map((card) => card.id);
  const prompt = buildFlowRebuttalPrompt(input);
  const raw = await input.provider.generateStructured<unknown>({
    schemaName: "FlowRebuttalSuggestions",
    schema: flowRebuttalSuggestionsJsonSchema,
    messages: messagesFromPromptBundle(prompt)
  });

  return normalizeFlowRebuttalSuggestions(raw, allowedEvidenceIds);
}
