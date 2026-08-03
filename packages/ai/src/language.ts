import type { LanguageMode } from "@debate/shared";

export type ResponseLanguage = LanguageMode;

export const debateTerminology = [
  "Evidence", "Flow", "Practice", "Round", "speech", "rebuttal", "clash", "weighing",
  "turn", "link", "impact", "frontline", "extension", "collapse", "drop", "framework", "warrant"
] as const;

export function responseLanguageInstruction(mode: ResponseLanguage) {
  if (mode === "en") {
    return "Write every human-readable string value in English. Keep JSON keys and schema identifiers unchanged.";
  }
  if (mode === "zh-terms-en") {
    return `Write human-readable prose in Simplified Chinese, but keep established debate terminology in English, including: ${debateTerminology.join(", ")}. Keep JSON keys and schema identifiers unchanged.`;
  }
  return "Write every human-readable string value in Simplified Chinese. Translate debate terminology into natural Chinese, except format abbreviations (PF, LD, BP), provider names, and proper nouns. Keep JSON keys and schema identifiers unchanged.";
}
