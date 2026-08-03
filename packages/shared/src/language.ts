export const languageModes = ["zh-CN", "zh-terms-en", "en"] as const;

export type LanguageMode = (typeof languageModes)[number];

export const languageScopes = [
  "common",
  "documents",
  "matches",
  "history",
  "practice",
  "library",
  "settings",
  "admin"
] as const;

export type LanguageScope = (typeof languageScopes)[number];
export type LanguageOverrides = Partial<Record<LanguageScope, LanguageMode>>;

export function isLanguageMode(value: unknown): value is LanguageMode {
  return typeof value === "string" && (languageModes as readonly string[]).includes(value);
}
export function isLanguageScope(value: unknown): value is LanguageScope {
  return typeof value === "string" && (languageScopes as readonly string[]).includes(value);
}
