import {
  createSession,
  sanitizeInternalRedirectTarget,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  verifyCredentials
} from "@/lib/auth";
import { checkRateLimit, redirectToRequestHost } from "@/lib/api-route-utils";
import { LANGUAGE_COOKIE } from "@/lib/language-core";
import { LANGUAGE_COOKIE_OPTIONS, initializeUserLanguage } from "@/lib/language-server";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const email = String(formData?.get("email") ?? "");
  const password = String(formData?.get("password") ?? "");
  const target = sanitizeInternalRedirectTarget(String(formData?.get("target") ?? "/app/documents"));
  const rateKey = `login:${email.trim().toLowerCase() || request.headers.get("x-forwarded-for") || "unknown"}`;

  if (!checkRateLimit(rateKey, 8, 60_000)) {
    return redirectToRequestHost(request, "/login?error=rate_limited");
  }

  const result = await verifyCredentials(email, password);
  if (!result) {
    return redirectToRequestHost(request, "/login?error=invalid");
  }

  const { token } = await createSession(result.user.id, result.workspace.id);
  const languageMode = result.user.languageMode ?? await initializeUserLanguage(result.user.id, request);
  const response = redirectToRequestHost(request, result.user.mustChangePassword ? "/app/change-password" : target);
  response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  response.cookies.set(LANGUAGE_COOKIE, languageMode, LANGUAGE_COOKIE_OPTIONS);
  return response;
}
