import { db, Prisma, type Role } from "@debate/db";
import {
  createSession,
  hashPassword,
  isPasswordStrongEnough,
  normalizeEmail,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS
} from "@/lib/auth";
import { pathWithAuthTarget, sanitizeInternalRedirectTarget } from "@/lib/auth-redirect";
import { redirectToRequestHost } from "@/lib/api-route-utils";
import { getSystemSettings } from "@/lib/settings";
import { languageModeFromRequest, LANGUAGE_COOKIE_OPTIONS } from "@/lib/language-server";
import { LANGUAGE_COOKIE } from "@/lib/language-core";

function fail(request: Request, code: string, target: string, invite?: string) {
  const path = invite
    ? `/register?error=${code}&invite=${encodeURIComponent(invite)}`
    : `/register?error=${code}`;
  return redirectToRequestHost(request, pathWithAuthTarget(path, target));
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const name = String(formData?.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData?.get("email") ?? ""));
  const password = String(formData?.get("password") ?? "");
  const inviteToken = String(formData?.get("invite") ?? "").trim();
  const target = sanitizeInternalRedirectTarget(String(formData?.get("target") ?? ""));
  const languageMode = languageModeFromRequest(request);

  if (!name || !email || !email.includes("@")) {
    return fail(request, "invalid", target, inviteToken);
  }
  if (!isPasswordStrongEnough(password)) {
    return fail(request, "weak", target, inviteToken);
  }

  // Resolve invitation (if the registration came from an invite link).
  let invitation: { id: string; email: string; role: Role; workspaceId: string } | null = null;
  if (inviteToken) {
    const found = await db.invitation.findUnique({ where: { token: inviteToken } });
    if (!found || found.acceptedAt || found.expiresAt.getTime() <= Date.now()) {
      return fail(request, "invite_invalid", target, inviteToken);
    }
    if (normalizeEmail(found.email) !== email) {
      return fail(request, "invite_email", target, inviteToken);
    }
    const workspace = await db.workspace.findUnique({ where: { id: found.workspaceId } });
    if (!workspace || workspace.deletedAt) {
      return fail(request, "invite_invalid", target, inviteToken);
    }
    invitation = { id: found.id, email: found.email, role: found.role, workspaceId: found.workspaceId };

    // Honor the inviting workspace's password policy for invited members.
    const settings = await getSystemSettings(found.workspaceId);
    if (password.length < settings.minPasswordLength) {
      return fail(request, "weak", target, inviteToken);
    }
  }

  const passwordHash = await hashPassword(password);

  let user: { id: string };
  let workspace: { id: string };

  try {
    ({ user, workspace } = await db.$transaction(async (tx) => {
      const createdUser = await tx.user.create({ data: { name, email, passwordHash, languageMode } });

      if (invitation) {
        await tx.membership.create({
          data: { userId: createdUser.id, workspaceId: invitation.workspaceId, role: invitation.role }
        });
        await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
        return { user: createdUser, workspace: { id: invitation.workspaceId } };
      }

      const createdWorkspace = await tx.workspace.create({ data: { name: `${name} Workspace` } });
      await tx.membership.create({ data: { userId: createdUser.id, workspaceId: createdWorkspace.id, role: "OWNER" } });
      return { user: createdUser, workspace: createdWorkspace };
    }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail(request, "exists", target, inviteToken);
    }
    throw error;
  }

  const { token } = await createSession(user.id, workspace.id);
  const response = redirectToRequestHost(request, target);
  response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  response.cookies.set(LANGUAGE_COOKIE, languageMode, LANGUAGE_COOKIE_OPTIONS);
  return response;
}
