import { AuthShell } from "@/components/auth-shell";

export default async function AdminLoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AuthShell
      eyebrow="网站管理端"
      title="管理员登录"
      description="管理在线用户、比赛房间、权限、资料库与 AI 审计。"
    >
      <div className="auth-panel-heading">
        <h2>管理员账号</h2>
        <p>仅具备系统管理权限的账号可以进入。</p>
      </div>
      <form action="/api/auth/admin-login" method="post" className="stack">
        {error ? <p className="form-message error-text" role="alert">账号密码不正确，或该账号没有管理员权限。</p> : null}
        <label className="field">
          <span>邮箱</span>
          <input name="email" type="email" autoComplete="email" placeholder="admin@example.com" required />
        </label>
        <label className="field">
          <span>密码</span>
          <input name="password" type="password" autoComplete="current-password" placeholder="输入密码" required />
        </label>
        <button className="button primary auth-submit" type="submit">登录管理端</button>
      </form>
    </AuthShell>
  );
}
