import { db, Prisma, type Role } from "@debate/db";
import {
  createSession,
  hashPassword,
  isPasswordStrongEnough,
  normalizeEmail,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS
} from "@/lib/auth";
import { redirectToRequestHost } from "@/lib/api-route-utils";
import { getSystemSettings } from "@/lib/settings";

function fail(request: Request, code: string, invite?: string) {
  const suffix = invite ? `&invite=${encodeURIComponent(invite)}` : "";
  return redirectToRequestHost(request, `/register?error=${code}${suffix}`);
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const name = String(formData?.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData?.get("email") ?? ""));
  const password = String(formData?.get("password") ?? "");
  const inviteToken = String(formData?.get("invite") ?? "").trim();

  if (!name || !email || !email.includes("@")) {
    return fail(request, "invalid", inviteToken);
  }
  if (!isPasswordStrongEnough(password)) {
    return fail(request, "weak", inviteToken);
  }

  // Resolve invitation (if the registration came from an invite link).
  let invitation: { id: string; email: string; role: Role; workspaceId: string } | null = null;
  if (inviteToken) {
    const found = await db.invitation.findUnique({ where: { token: inviteToken } });
    if (!found || found.acceptedAt || found.expiresAt.getTime() <= Date.now()) {
      return fail(request, "invite_invalid", inviteToken);
    }
    if (normalizeEmail(found.email) !== email) {
      return fail(request, "invite_email", inviteToken);
    }
    const workspace = await db.workspace.findUnique({ where: { id: found.workspaceId } });
    if (!workspace || workspace.deletedAt) {
      return fail(request, "invite_invalid", inviteToken);
    }
    invitation = { id: found.id, email: found.email, role: found.role, workspaceId: found.workspaceId };

    // Honor the inviting workspace's password policy for invited members.
    const settings = await getSystemSettings(found.workspaceId);
    if (password.length < settings.minPasswordLength) {
      return fail(request, "weak", inviteToken);
    }
  }

  const passwordHash = await hashPassword(password);

  let user: { id: string };
  let workspace: { id: string };

  try {
    ({ user, workspace } = await db.$transaction(async (tx) => {
      const createdUser = await tx.user.create({ data: { name, email, passwordHash } });

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
      return fail(request, "exists", inviteToken);
    }
    throw error;
  }

  const { token } = await createSession(user.id, workspace.id);
  const response = redirectToRequestHost(request, "/app/documents");
  response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return response;
}
