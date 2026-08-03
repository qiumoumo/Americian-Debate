import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getSession } from "@/lib/auth";
import { pathWithAuthTarget, sanitizeInternalRedirectTarget } from "@/lib/auth-redirect";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "邮箱或密码不正确。",
  rate_limited: "尝试次数过多，请稍后再试。"
};

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; target?: string }>;
}) {
  const { error, target: requestedTarget } = await searchParams;
  const target = sanitizeInternalRedirectTarget(requestedTarget);
  const session = await getSession();
  if (session?.user.mustChangePassword) redirect("/app/change-password");
  if (session) redirect(target);

  return (
    <AuthShell
      eyebrow="用户端登录"
      title="回到你的辩论工作区"
      description="资料库、比赛房间、训练与复盘，登录后从上次的目标继续。"
    >
      <div className="auth-panel-heading">
        <h2>登录账号</h2>
        <p>使用邮箱和密码继续。</p>
      </div>
      <form action="/api/auth/login" method="post" className="stack">
        <input type="hidden" name="target" value={target} />
        {error ? <p className="form-message error-text" role="alert">{ERROR_MESSAGES[error] ?? ERROR_MESSAGES.invalid}</p> : null}
        <label className="field">
          <span>邮箱</span>
          <input name="email" type="email" autoComplete="email" placeholder="name@example.com" required />
        </label>
        <label className="field">
          <span>密码</span>
          <input name="password" type="password" autoComplete="current-password" placeholder="输入密码" required />
        </label>
        <button className="button primary auth-submit" type="submit">登录</button>
      </form>
      <p className="auth-switch">
        还没有账号？<Link href={pathWithAuthTarget("/register", target)}>注册新账号</Link>
      </p>
    </AuthShell>
  );
}
