import { AdminShell } from "@/components/admin-shell";
import { SectionCard } from "@/components/section-card";
import { requireAdmin } from "@/lib/auth";
import { sessionShellUser } from "@/lib/session-props";

interface AdminPlaceholderProps {
  activeHref: string;
  eyebrow: string;
  title: string;
  intro: string;
  phaseNote: string;
}

/**
 * Skeleton page for admin sections that ship in a later phase. Keeps the nav
 * fully wired (each route exists + is gated by requireAdmin) while the real
 * feature is built out.
 */
export async function AdminPlaceholder({ activeHref, eyebrow, title, intro, phaseNote }: AdminPlaceholderProps) {
  const session = await requireAdmin();

  return (
    <AdminShell activeHref={activeHref} user={sessionShellUser(session)}>
      <section className="hero">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{intro}</p>
      </section>

      <SectionCard title="即将上线" description="该模块已在计划中，将在后续阶段实现。">
        <p className="empty-state">{phaseNote}</p>
      </SectionCard>
    </AdminShell>
  );
}
