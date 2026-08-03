import {
  isLanguageMode,
  isLanguageScope,
  languageScopes,
  type LanguageMode,
  type LanguageOverrides,
  type LanguageScope
} from "@debate/shared";

export const LANGUAGE_COOKIE = "debate_language_mode";
export const LANGUAGE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface LanguagePreferences {
  globalMode: LanguageMode;
  overrides: LanguageOverrides;
  source: "account" | "cookie" | "browser";
}

export function parseLanguageOverrides(value: unknown): LanguageOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: LanguageOverrides = {};
  for (const [scope, mode] of Object.entries(value)) {
    if (isLanguageScope(scope) && isLanguageMode(mode)) result[scope] = mode;
  }
  return result;
}

export function browserDefaultLanguage(acceptLanguage: string | null | undefined): LanguageMode {
  const primary = String(acceptLanguage ?? "")
    .split(",")
    .map((item) => item.trim().split(";")[0]?.toLowerCase())
    .find(Boolean);
  return primary?.startsWith("zh") ? "zh-terms-en" : "en";
}

export function resolveLanguagePreferences(input: {
  accountMode?: unknown;
  accountOverrides?: unknown;
  cookieMode?: unknown;
  acceptLanguage?: string | null;
}): LanguagePreferences {
  if (isLanguageMode(input.accountMode)) {
    return {
      globalMode: input.accountMode,
      overrides: parseLanguageOverrides(input.accountOverrides),
      source: "account"
    };
  }
  if (isLanguageMode(input.cookieMode)) {
    return { globalMode: input.cookieMode, overrides: {}, source: "cookie" };
  }
  return {
    globalMode: browserDefaultLanguage(input.acceptLanguage),
    overrides: {},
    source: "browser"
  };
}

export function effectiveLanguage(preferences: LanguagePreferences, scope: LanguageScope): LanguageMode {
  return preferences.overrides[scope] ?? preferences.globalMode;
}

export function languageHtmlTag(mode: LanguageMode) {
  return mode === "en" ? "en" : "zh-CN";
}

export function dateLocaleForMode(mode: LanguageMode) {
  return mode === "en" ? "en-US" : "zh-CN";
}

export function scopeForPathname(pathname: string): LanguageScope {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/app/documents")) return "documents";
  if (pathname.startsWith("/app/matches")) return "matches";
  if (pathname.startsWith("/app/history")) return "history";
  if (pathname.startsWith("/app/practice")) return "practice";
  if (pathname.startsWith("/app/library")) return "library";
  if (pathname.startsWith("/app/settings") || pathname.startsWith("/app/change-password")) return "settings";
  return "common";
}

export function selectLanguageSession<T extends { token: string; kind: string }>(input: {
  sessions: T[];
  userToken?: string;
  adminToken?: string;
  scope: LanguageScope;
}): T | undefined {
  const userSession = input.sessions.find((session) => session.token === input.userToken && session.kind === "user");
  const adminSession = input.sessions.find((session) => session.token === input.adminToken && session.kind === "admin");
  return input.scope === "admin" ? adminSession ?? userSession : userSession ?? adminSession;
}

export function sanitizePreferenceUpdate(input: {
  globalMode?: unknown;
  overrides?: unknown;
}): { globalMode?: LanguageMode; overrides?: LanguageOverrides } {
  const result: { globalMode?: LanguageMode; overrides?: LanguageOverrides } = {};
  if (input.globalMode !== undefined) {
    if (!isLanguageMode(input.globalMode)) throw new Error("Invalid language mode");
    result.globalMode = input.globalMode;
  }
  if (input.overrides !== undefined) {
    if (!input.overrides || typeof input.overrides !== "object" || Array.isArray(input.overrides)) {
      throw new Error("Invalid language overrides");
    }
    const raw = input.overrides as Record<string, unknown>;
    for (const key of Object.keys(raw)) {
      if (!isLanguageScope(key)) throw new Error(`Invalid language scope: ${key}`);
      if (raw[key] !== null && raw[key] !== "inherit" && !isLanguageMode(raw[key])) {
        throw new Error(`Invalid language mode for ${key}`);
      }
    }
    result.overrides = Object.fromEntries(
      languageScopes.flatMap((scope) => isLanguageMode(raw[scope]) ? [[scope, raw[scope]]] : [])
    ) as LanguageOverrides;
  }
  return result;
}
