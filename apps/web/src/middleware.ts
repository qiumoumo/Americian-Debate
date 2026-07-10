import { NextResponse, type NextRequest } from "next/server";

// Kept in sync with ADMIN_SESSION_COOKIE in src/lib/auth.ts. Middleware runs on
// the edge runtime and cannot import auth.ts (Prisma / node APIs), so the cookie
// name is inlined here. This is defense-in-depth only: the authoritative session
// + role check still happens in each admin page via requireAdmin().
const ADMIN_SESSION_COOKIE = "debate_admin_session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The admin login page must stay reachable without an admin session.
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    return NextResponse.next();
  }

  const hasAdminCookie = Boolean(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
  if (!hasAdminCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"]
};
