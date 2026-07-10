import { SectionCard } from "@/components/section-card";

export default async function AdminLoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="login-shell">
      <section className="hero login-hero">
        <div className="eyebrow">网站管理端</div>
        <h1>管理员登录</h1>
        <p>仅 OWNER / COACH 角色可进入管理端，管理队伍、权限、资料库和 AI 审计。</p>
      </section>

      <div className="grid two">
        <SectionCard title="管理员账号" description="使用具备管理权限的账号登录。">
          <form action="/api/auth/admin-login" method="post" className="stack">
            {error ? <p className="empty-state">账号密码不正确，或该账号没有管理员权限。</p> : null}
            <label className="field">
              <span>邮箱</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label className="field">
              <span>密码</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button className="button primary" type="submit">登录管理端</button>
          </form>
        </SectionCard>
      </div>
    </main>
  );
}
