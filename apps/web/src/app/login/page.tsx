import Link from "next/link";
import { SectionCard } from "@/components/section-card";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="login-shell">
      <section className="hero login-hero">
        <div className="eyebrow">用户端登录</div>
        <h1>登录</h1>
        <p>使用邮箱和密码进入资料库、比赛房间、Practice 和用户设置。</p>
      </section>

      <div className="grid">
        <SectionCard title="登录账号" description="没有账号？可自助注册。">
          <form action="/api/auth/login" method="post" className="stack">
            {error ? <p className="empty-state">邮箱或密码不正确。</p> : null}
            <label className="field">
              <span>邮箱</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label className="field">
              <span>密码</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button className="button primary" type="submit">登录</button>
          </form>
          <p className="small-note">
            还没有账号？<Link href="/register">注册新账号</Link>
          </p>
        </SectionCard>
      </div>
    </main>
  );
}
