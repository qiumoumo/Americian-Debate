import {
  ADMIN_SESSION_COOKIE,
  createSession,
  SESSION_COOKIE_OPTIONS,
  verifyAdminCredentials
} from "@/lib/auth";
import { checkRateLimit, redirectToRequestHost } from "@/lib/api-route-utils";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const email = String(formData?.get("email") ?? "");
  const password = String(formData?.get("password") ?? "");
  const rateKey = `admin-login:${email.trim().toLowerCase() || request.headers.get("x-forwarded-for") || "unknown"}`;

  if (!checkRateLimit(rateKey, 6, 60_000)) {
    return redirectToRequestHost(request, "/admin/login?error=rate_limited");
  }

  const result = await verifyAdminCredentials(email, password);
  if (!result) {
    return redirectToRequestHost(request, "/admin/login?error=forbidden");
  }

  const { token } = await createSession(result.user.id, result.workspace.id, "admin");
  const response = redirectToRequestHost(request, "/admin");
  response.cookies.set(ADMIN_SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return response;
}
