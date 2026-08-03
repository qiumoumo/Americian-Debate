"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db } from "@debate/db";
import { isLanguageScope, type LanguageMode, type LanguageOverrides, type LanguageScope } from "@debate/shared";
import {
  LANGUAGE_COOKIE,
  sanitizePreferenceUpdate
} from "@/lib/language-core";
import { LANGUAGE_COOKIE_OPTIONS, getRequestLanguageAccountId, getRequestLanguagePreferences } from "@/lib/language-server";
import { saveAccountLanguagePreferences } from "@/lib/language-preferences";

function validScope(scope: unknown): LanguageScope {
  if (!isLanguageScope(scope)) throw new Error("Invalid language scope");
  return scope;
}

export async function setGlobalLanguageAction(mode: LanguageMode, currentScope: LanguageScope) {
  const update = sanitizePreferenceUpdate({ globalMode: mode });
  const accountId = await getRequestLanguageAccountId(validScope(currentScope));
  if (accountId) {
    await db.user.update({ where: { id: accountId }, data: { languageMode: update.globalMode } });
  }
  (await cookies()).set(LANGUAGE_COOKIE, update.globalMode!, LANGUAGE_COOKIE_OPTIONS);
  revalidatePath("/", "layout");
  return { ok: true } as const;
}

export async function saveLanguagePreferencesAction(input: {
  globalMode: LanguageMode;
  overrides: LanguageOverrides & Record<string, LanguageMode | "inherit" | undefined>;
  currentScope: LanguageScope;
}) {
  const accountId = await getRequestLanguageAccountId(validScope(input.currentScope));
  if (!accountId) throw new Error("Authentication required for module language preferences");
  const update = sanitizePreferenceUpdate(input);
  await saveAccountLanguagePreferences(accountId, {
    globalMode: update.globalMode!,
    overrides: update.overrides ?? {}
  });
  (await cookies()).set(LANGUAGE_COOKIE, update.globalMode!, LANGUAGE_COOKIE_OPTIONS);
  revalidatePath("/", "layout");
  return { ok: true } as const;
}

export async function readLanguagePreferencesAction(currentScope: LanguageScope) {
  const accountId = await getRequestLanguageAccountId(validScope(currentScope));
  return { preferences: await getRequestLanguagePreferences(), authenticated: Boolean(accountId) };
}
