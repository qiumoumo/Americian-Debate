import { SectionCard } from "@/components/section-card";
import { requireUser } from "@/lib/auth";
import { changeRequiredPassword } from "./actions";

const ERRORS: Record<string, string> = {
  weak: "新密码至少需要 8 个字符。",
  mismatch: "两次输入的密码不一致。"
};

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requireUser({ allowPasswordChange: true });
  const { error } = await searchParams;
  return (
    <main className="login-shell">
      <section className="hero login-hero">
        <div className="eyebrow">Security</div>
        <h1>设置新密码</h1>
        <p>{session.user.email} 正在使用管理员生成的临时密码。设置新密码后才能继续使用应用。</p>
      </section>
      <SectionCard title="更换密码" description="新密码不会向管理员显示。">
        <form action={changeRequiredPassword} className="stack">
          {error ? <p className="empty-state">{ERRORS[error] ?? "密码修改失败。"}</p> : null}
          <label className="field"><span>新密码</span><input name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
          <label className="field"><span>确认新密码</span><input name="confirmation" type="password" minLength={8} autoComplete="new-password" required /></label>
          <button className="button primary" type="submit">保存并继续</button>
        </form>
      </SectionCard>
    </main>
  );
}
