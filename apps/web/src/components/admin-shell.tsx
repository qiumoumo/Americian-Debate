import Link from "next/link";
import { adminNavigation } from "@/lib/navigation";

interface AdminShellProps {
  activeHref?: string;
  children: React.ReactNode;
  user?: {
    name: string;
    email: string;
    role: string;
    workspaceName: string;
  };
}

export function AdminShell({ activeHref, children, user }: AdminShellProps) {
  return (
    <div className="page-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="美辩 home">
          <span className="brand-mark">美</span>
          <span>
            <strong className="brand-title">Admin</strong>
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
        <nav className="nav-group" aria-label="Admin navigation">
          {adminNavigation.map((item) => (
            <Link key={item.href} className="nav-link" href={item.href} data-active={activeHref === item.href}>
              <span>{item.label}</span>
              <span>{item.badge}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-actions">
          {user ? (
            <form action="/api/auth/admin-logout" method="post">
              <button className="button" type="submit">退出登录</button>
            </form>
          ) : null}
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
