import Link from "next/link";
import { userNavigation } from "@/lib/navigation";
import { ReliableLink } from "@/components/reliable-link";

interface ClientShellProps {
  activeHref?: string;
  children: React.ReactNode;
  user?: {
    name: string;
    email: string;
    role: string;
    workspaceName: string;
  };
}

export function ClientShell({ activeHref, children, user }: ClientShellProps) {
  return (
    <div className="page-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Debate Suite home">
          <span className="brand-mark">DS</span>
          <span>
            <strong className="brand-title">Debate Suite</strong>
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
          {userNavigation.map((item) => (
            <ReliableLink key={item.href} className="nav-link" href={item.href} data-active={activeHref === item.href}>
              <span>{item.label}</span>
              <span>{item.badge}</span>
            </ReliableLink>
          ))}
        </nav>
        <div className="sidebar-actions">
          {user ? (
            <form action="/api/auth/logout" method="post">
              <button className="button" type="submit">退出登录</button>
            </form>
          ) : null}
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
