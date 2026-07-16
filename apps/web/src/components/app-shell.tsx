import Link from "next/link";
import { userNavigation } from "@/lib/navigation";
import { PresenceAgent } from "@/components/presence-agent";
import { ReliableLink } from "@/components/reliable-link";

interface AppShellProps {
  activeHref?: string;
  children: React.ReactNode;
  note?: string;
  user?: {
    name: string;
    email: string;
    role: string;
    workspaceName: string;
  };
}

export function AppShell({ activeHref, children, note, user }: AppShellProps) {
  const navigation = userNavigation;

  return (
    <div className="page-shell">
      {user ? <PresenceAgent /> : null}
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="美辩 home">
          <span className="brand-mark">美</span>
          <span>
            <strong className="brand-title">美辩</strong>
            <p className="brand-subtitle">本地优先辩论工作台</p>
          </span>
        </Link>
        {user ? (
          <div className="user-card">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
            <span className="pill">{user.role}</span>
            <small>{user.workspaceName}</small>
          </div>
        ) : null}
        <nav className="nav-group" aria-label="Primary navigation">
          {navigation.map((item) => (
            <ReliableLink key={item.href} className="nav-link" href={item.href} data-active={activeHref === item.href}>
              <span>{item.label}</span>
              <span>{item.badge}</span>
            </ReliableLink>
          ))}
        </nav>
        <div className="sidebar-note">
          {note ?? "先做本地单人 MVP：结构化 evidence、比赛 flow、计时器、历史记录和可替换 AI provider。"}
        </div>
        {user ? (
          <form action="/api/auth/logout" method="post" className="logout-form">
            <button className="button" type="submit">退出登录</button>
          </form>
        ) : null}
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
