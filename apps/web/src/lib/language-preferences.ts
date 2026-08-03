import { db } from "@debate/db";
import type { LanguageMode, LanguageOverrides } from "@debate/shared";
import { parseLanguageOverrides, sanitizePreferenceUpdate } from "./language-core.ts";

export async function readAccountLanguagePreferences(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { languageMode: true, languageOverridesJson: true }
  });
  return user ? {
    globalMode: user.languageMode,
    overrides: parseLanguageOverrides(user.languageOverridesJson)
  } : null;
}

export async function saveAccountLanguagePreferences(userId: string, input: {
  globalMode: LanguageMode;
  overrides: LanguageOverrides & Record<string, LanguageMode | "inherit" | undefined>;
}) {
  const update = sanitizePreferenceUpdate(input);
  return db.user.update({
    where: { id: userId },
    data: {
      languageMode: update.globalMode,
      languageOverridesJson: JSON.parse(JSON.stringify(update.overrides ?? {}))
    },
    select: { id: true, languageMode: true, languageOverridesJson: true }
  });
}

export async function saveGlobalLanguagePreference(userId: string, globalMode: LanguageMode) {
  const update = sanitizePreferenceUpdate({ globalMode });
  if (!update.globalMode) throw new Error("Global language mode is required");

  return db.user.update({
    where: { id: userId },
    data: { languageMode: update.globalMode },
    select: { id: true, languageMode: true }
  });
}
