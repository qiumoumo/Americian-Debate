import { ADMIN_SESSION_COOKIE, deleteSessionByToken, SESSION_COOKIE_OPTIONS } from "@/lib/auth";
import { redirectToRequestHost } from "@/lib/api-route-utils";

export async function POST(request: Request) {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_SESSION_COOKIE}=`))
    ?.slice(ADMIN_SESSION_COOKIE.length + 1);

  await deleteSessionByToken(token);

  const response = redirectToRequestHost(request, "/admin/login");
  response.cookies.set(ADMIN_SESSION_COOKIE, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
