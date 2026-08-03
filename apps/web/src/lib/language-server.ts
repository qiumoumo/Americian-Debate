import { cache } from "react";
import { cookies, headers } from "next/headers";
import { db } from "@debate/db";
import type { LanguageMode, LanguageScope } from "@debate/shared";
import { ADMIN_SESSION_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import {
  LANGUAGE_COOKIE,
  LANGUAGE_COOKIE_MAX_AGE_SECONDS,
  effectiveLanguage,
  resolveLanguagePreferences,
  selectLanguageSession,
  type LanguagePreferences
} from "@/lib/language-core";

export const LANGUAGE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.COOKIE_SECURE === "true",
  path: "/",
  maxAge: LANGUAGE_COOKIE_MAX_AGE_SECONDS
};

async function readLanguageAccount(scope: LanguageScope) {
  const cookieStore = await cookies();
  const userToken = cookieStore.get(SESSION_COOKIE)?.value;
  const adminToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const tokens = [userToken, adminToken].filter((value): value is string => Boolean(value));
  if (!tokens.length) return null;

  const sessions = await db.session.findMany({
    where: { token: { in: tokens }, expiresAt: { gt: new Date() } },
    include: { user: true }
  });
  const preferred = selectLanguageSession({ sessions, userToken, adminToken, scope });
  if (!preferred || preferred.user.disabledAt) return null;
  return preferred.user;
}

async function getRequestScope() {
  const headerStore = await headers();
  const pathname = headerStore.get("x-debate-pathname") ?? "/";
  const { scopeForPathname } = await import("@/lib/language-core");
  return scopeForPathname(pathname);
}

export const getRequestLanguagePreferences = cache(async (): Promise<LanguagePreferences> => {
  const [cookieStore, headerStore, scope] = await Promise.all([cookies(), headers(), getRequestScope()]);
  const account = await readLanguageAccount(scope);
  return resolveLanguagePreferences({
    accountMode: account?.languageMode,
    accountOverrides: account?.languageOverridesJson,
    cookieMode: cookieStore.get(LANGUAGE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language")
  });
});

export async function getRequestLanguageAccountId(scope: LanguageScope) {
  return (await readLanguageAccount(scope))?.id ?? null;
}

export async function getEffectiveLanguage(scope: LanguageScope): Promise<LanguageMode> {
  return effectiveLanguage(await getRequestLanguagePreferences(), scope);
}

export async function getEffectiveLanguageForUser(userId: string, scope: LanguageScope): Promise<LanguageMode> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { languageMode: true, languageOverridesJson: true }
  });
  if (user?.languageMode) {
    return effectiveLanguage(resolveLanguagePreferences({
      accountMode: user.languageMode,
      accountOverrides: user.languageOverridesJson
    }), scope);
  }
  return getEffectiveLanguage(scope);
}

export function languageModeFromRequest(request: Request): LanguageMode {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const escapedName = LANGUAGE_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rawCookieMode = new RegExp(`(?:^|;\\s*)${escapedName}=([^;]+)`).exec(cookieHeader)?.[1] ?? "";
  let cookieMode = rawCookieMode;
  try {
    cookieMode = decodeURIComponent(rawCookieMode);
  } catch {
    // Treat malformed visitor cookies as absent and fall back to the browser language.
  }
  return resolveLanguagePreferences({
    cookieMode,
    acceptLanguage: request.headers.get("accept-language")
  }).globalMode;
}

export async function initializeUserLanguage(userId: string, request: Request) {
  const mode = languageModeFromRequest(request);
  await db.user.updateMany({
    where: { id: userId, languageMode: null },
    data: { languageMode: mode }
  });
  return mode;
}
