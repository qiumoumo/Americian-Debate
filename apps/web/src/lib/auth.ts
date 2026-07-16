import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@debate/db";
import { hasSystemAdminAccess } from "@/lib/admin-policy";

export const SESSION_COOKIE = "debate_session";
export const ADMIN_SESSION_COOKIE = "debate_admin_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  // LAN deployments use plain HTTP by default. Set COOKIE_SECURE=true only
  // when the host is actually served through HTTPS.
  secure: process.env.COOKIE_SECURE === "true",
  path: "/",
  maxAge: SESSION_COOKIE_MAX_AGE_SECONDS
};

export type SessionKind = "user" | "admin";

const BCRYPT_ROUNDS = 12;
export const MIN_PASSWORD_LENGTH = 8;

export function sanitizeInternalRedirectTarget(target: string | null | undefined) {
  const fallback = "/app/documents";
  const value = String(target ?? fallback).trim();
  if (!value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  try {
    const parsed = new URL(value, "http://debate.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

// ---- Password hashing ----

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function isPasswordStrongEnough(password: string) {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

export function normalizeEmail(email: string | null | undefined) {
  return String(email ?? "").trim().toLowerCase();
}

// ---- Session lifecycle (opaque token stored in DB) ----

function generateSessionToken() {
  return randomBytes(32).toString("hex");
}

/**
 * Creates a Session row and returns the opaque token. Callers write the token
 * to the appropriate cookie (SESSION_COOKIE for user sessions,
 * ADMIN_SESSION_COOKIE for admin sessions).
 */
export async function createSession(userId: string, workspaceId: string, kind: SessionKind = "user") {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_COOKIE_MAX_AGE_SECONDS * 1000);
  await db.session.create({ data: { token, userId, workspaceId, kind, expiresAt, lastSeenAt: new Date() } });
  return { token, expiresAt };
}

export async function deleteSessionByToken(token: string | null | undefined) {
  if (!token) return;
  await db.session.deleteMany({ where: { token } });
}

// ---- Credential verification ----

/**
 * Verifies email + password. Returns the membership context needed to seed a
 * session, or null when the credentials are invalid.
 */
export async function verifyCredentials(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) return null;

  const user = await db.user.findUnique({
    where: { email: normalizedEmail },
    include: { memberships: { include: { workspace: true } } }
  });
  if (!user?.passwordHash) return null;
  if (user.disabledAt) return null;

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;

  const membership = user.memberships.find((item) => !item.workspace.deletedAt);
  if (!membership) return null;

  return { user, workspace: membership.workspace, role: membership.role, membership };
}

/**
 * Verifies credentials and requires host-level system administrator access.
 */
export async function verifyAdminCredentials(email: string, password: string) {
  const result = await verifyCredentials(email, password);
  if (!result) return null;
  if (result.user.mustChangePassword) return null;
  if (!hasSystemAdminAccess(result.user)) return null;
  return result;
}

// ---- Session reading ----

/**
 * Reads and validates a session for a specific cookie + kind. A user cookie can
 * only resolve a "user" session and the admin cookie only an "admin" session,
 * so the two session scopes are fully isolated. Disabled users and deleted
 * workspaces never resolve.
 */
async function readSession(cookieName: string, kind: SessionKind) {
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({ where: { token } });
  if (!session || session.kind !== kind) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await deleteSessionByToken(token);
    return null;
  }

  const membership = await db.membership.findUnique({
    where: { userId_workspaceId: { userId: session.userId, workspaceId: session.workspaceId } },
    include: { user: true, workspace: true }
  });

  if (!membership || membership.workspace.deletedAt || membership.user.disabledAt) return null;

  return {
    sessionId: session.id,
    user: membership.user,
    workspace: membership.workspace,
    role: membership.role,
    membership
  };
}

export function getSession() {
  return readSession(SESSION_COOKIE, "user");
}

/**
 * Reads the admin session from the dedicated admin cookie. Requires an
 * system administrator status; a user session cannot grant admin access.
 */
export async function getAdminSession() {
  const session = await readSession(ADMIN_SESSION_COOKIE, "admin");
  if (!session) return null;
  if (!hasSystemAdminAccess(session.user)) return null;
  return session;
}

export async function requireUser(options: { allowPasswordChange?: boolean } = {}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (session.user.mustChangePassword && !options.allowPasswordChange) {
    redirect("/app/change-password");
  }
  return session;
}

export async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }
  return session;
}

export const requireSystemAdmin = requireAdmin;

export async function touchCurrentUserSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const result = await db.session.updateMany({
    where: { token, kind: "user", expiresAt: { gt: new Date() } },
    data: { lastSeenAt: new Date() }
  });
  return result.count === 1;
}
