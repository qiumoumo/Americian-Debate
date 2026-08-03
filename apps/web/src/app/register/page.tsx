import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@debate/db";
import { AuthShell } from "@/components/auth-shell";
import { getSession, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { pathWithAuthTarget, sanitizeInternalRedirectTarget } from "@/lib/auth-redirect";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "请填写姓名、有效邮箱。",
  weak: `密码至少需要 ${MIN_PASSWORD_LENGTH} 位。`,
  exists: "该邮箱已注册，请直接登录。",
  invite_invalid: "邀请链接无效或已过期，请联系管理员重新邀请。",
  invite_email: "注册邮箱需与被邀请的邮箱一致。"
};

export default async function RegisterPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; invite?: string; target?: string }>;
}) {
  const { error, invite, target: requestedTarget } = await searchParams;
  const target = sanitizeInternalRedirectTarget(requestedTarget);
  const session = await getSession();
  if (session?.user.mustChangePassword) redirect("/app/change-password");
  if (session) redirect(target);
  const message = error ? ERROR_MESSAGES[error] ?? "注册失败，请重试。" : null;

  // If arriving from an invite link, resolve it to prefill the email and show context.
  const invitation = invite
    ? await db.invitation.findUnique({ where: { token: invite }, include: { workspace: true } })
    : null;
  const validInvite =
    invitation && !invitation.acceptedAt && invitation.expiresAt.getTime() > Date.now() ? invitation : null;

  return (
    <AuthShell
      eyebrow="创建账号"
      title={validInvite ? `加入「${validInvite.workspace.name}」` : "建立你的辩论工作区"}
      description={validInvite
        ? `你将以 ${validInvite.role} 身份加入团队，注册后即可继续。`
        : "注册后自动创建个人工作区，马上开始整理资料和训练。"}
    >
      <div className="auth-panel-heading">
        <h2>新账号</h2>
        <p>邮箱将作为登录账号。</p>
      </div>
      <form action="/api/auth/register" method="post" className="stack">
        <input type="hidden" name="target" value={target} />
        {message ? <p className="form-message error-text" role="alert">{message}</p> : null}
        {invite && !validInvite ? <p className="form-message error-text" role="alert">邀请链接无效或已过期。</p> : null}
        {validInvite ? <input type="hidden" name="invite" value={invite} /> : null}
        <label className="field">
          <span>姓名</span>
          <input name="name" type="text" autoComplete="name" placeholder="你的姓名" required />
        </label>
        <label className="field">
          <span>邮箱</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={validInvite?.email ?? ""}
            placeholder="name@example.com"
            readOnly={Boolean(validInvite)}
            required
          />
        </label>
        <label className="field">
          <span>密码（至少 {MIN_PASSWORD_LENGTH} 位）</span>
          <input name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} placeholder="创建密码" required />
        </label>
        <button className="button primary auth-submit" type="submit">注册并进入</button>
      </form>
      <p className="auth-switch">
        已有账号？<Link href={pathWithAuthTarget("/login", target)}>去登录</Link>
      </p>
    </AuthShell>
  );
}
