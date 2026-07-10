import Link from "next/link";
import { db } from "@debate/db";
import { SectionCard } from "@/components/section-card";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth";

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
  searchParams: Promise<{ error?: string; invite?: string }>;
}) {
  const { error, invite } = await searchParams;
  const message = error ? ERROR_MESSAGES[error] ?? "注册失败，请重试。" : null;

  // If arriving from an invite link, resolve it to prefill the email and show context.
  const invitation = invite
    ? await db.invitation.findUnique({ where: { token: invite }, include: { workspace: true } })
    : null;
  const validInvite =
    invitation && !invitation.acceptedAt && invitation.expiresAt.getTime() > Date.now() ? invitation : null;

  return (
    <main className="login-shell">
      <section className="hero login-hero">
        <div className="eyebrow">注册</div>
        <h1>创建账号</h1>
        <p>
          {validInvite
            ? `你被邀请加入「${validInvite.workspace.name}」，角色 ${validInvite.role}。`
            : "注册后自动创建你自己的工作区，可直接进入用户端。"}
        </p>
      </section>

      <div className="grid">
        <SectionCard title="新账号" description="邮箱将作为登录账号。">
          <form action="/api/auth/register" method="post" className="stack">
            {message ? <p className="empty-state">{message}</p> : null}
            {invite && !validInvite ? <p className="empty-state">邀请链接无效或已过期。</p> : null}
            {validInvite ? <input type="hidden" name="invite" value={invite} /> : null}
            <label className="field">
              <span>姓名</span>
              <input name="name" type="text" autoComplete="name" required />
            </label>
            <label className="field">
              <span>邮箱</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={validInvite?.email ?? ""}
                readOnly={Boolean(validInvite)}
                required
              />
            </label>
            <label className="field">
              <span>密码（至少 {MIN_PASSWORD_LENGTH} 位）</span>
              <input name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
            </label>
            <button className="button primary" type="submit">注册并进入</button>
          </form>
          <p className="small-note">
            已有账号？<Link href="/login">去登录</Link>
          </p>
        </SectionCard>
      </div>
    </main>
  );
}
