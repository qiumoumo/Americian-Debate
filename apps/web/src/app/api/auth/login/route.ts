import {
  createSession,
  sanitizeInternalRedirectTarget,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  verifyCredentials
} from "@/lib/auth";
import { checkRateLimit, redirectToRequestHost } from "@/lib/api-route-utils";

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
  const response = redirectToRequestHost(request, result.user.mustChangePassword ? "/app/change-password" : target);
  response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return response;
}
