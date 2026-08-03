import { NextResponse } from "next/server";
import { db } from "@debate/db";
import { LANGUAGE_COOKIE, sanitizePreferenceUpdate } from "@/lib/language-core";
import { getAdminSession, getSession } from "@/lib/auth";
import { jsonError, readLimitedJson } from "@/lib/api-route-utils";
import { LANGUAGE_COOKIE_OPTIONS } from "@/lib/language-server";
import { saveAccountLanguagePreferences } from "@/lib/language-preferences";

const MAX_BODY_BYTES = 4_000;

type LanguageSurface = "user" | "admin";

function requestSurface(request: Request): LanguageSurface | null {
  const referrer = request.headers.get("referer");
  if (!referrer) return null;

  try {
    const referrerUrl = new URL(referrer);
    if (referrerUrl.origin !== new URL(request.url).origin) return null;
    return referrerUrl.pathname === "/admin" || referrerUrl.pathname.startsWith("/admin/")
      ? "admin"
      : "user";
  } catch {
    return null;
  }
}

async function accountIdForSurface(surface: LanguageSurface | null) {
  if (surface === "admin") return (await getAdminSession())?.user.id ?? null;
  if (surface === "user") return (await getSession())?.user.id ?? null;
  return null;
}

export async function POST(request: Request) {
  const { body, response: bodyError } = await readLimitedJson<{
    globalMode?: unknown;
    overrides?: unknown;
  }>(request, MAX_BODY_BYTES);
  if (bodyError) return bodyError;
  if (!body) return jsonError("Language preference is required.", 400);

  let update;
  try {
    update = sanitizePreferenceUpdate(body);
    if (!update.globalMode) throw new Error("Global language mode is required");
  } catch {
    return jsonError("Invalid language preference.", 400);
  }

  try {
    const accountId = await accountIdForSurface(requestSurface(request));
    if (body.overrides !== undefined) {
      if (!accountId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      await saveAccountLanguagePreferences(accountId, {
        globalMode: update.globalMode,
        overrides: update.overrides ?? {}
      });
    } else if (accountId) {
      await db.user.update({ where: { id: accountId }, data: { languageMode: update.globalMode } });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(LANGUAGE_COOKIE, update.globalMode, LANGUAGE_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    console.error("Failed to save language preference", error);
    return jsonError("Could not save language preference.", 500);
  }
}
