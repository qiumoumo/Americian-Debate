import { redirect } from "next/navigation";
import { ReliableLink } from "@/components/reliable-link";
import { ShapeGridBackground } from "@/components/shape-grid-background";
import { getSession } from "@/lib/auth";
import {
  DEFAULT_AUTH_TARGET,
  pathWithAuthTarget,
  sanitizeInternalRedirectTarget
} from "@/lib/auth-redirect";

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ target?: string }>;
}) {
  const { target: requestedTarget } = await searchParams;
  const target = sanitizeInternalRedirectTarget(requestedTarget);
  const session = await getSession();
  if (session?.user.mustChangePassword) redirect("/app/change-password");
  if (session) redirect(DEFAULT_AUTH_TARGET);

  return (
    <main className="start-page">
      <ShapeGridBackground />
      <div className="start-page-frame">
        <div className="start-brand" aria-label="美辩 Debate Suite">
          <span className="brand-mark">美</span>
          <span>Debate Suite</span>
        </div>
        <section className="start-content">
          <div className="eyebrow">American Debate Workspace</div>
          <h1>美辩工作台</h1>
          <p>把资料、论证、比赛和训练放进同一个清晰、可靠的辩论工作区。</p>
          <div className="start-actions">
            <ReliableLink className="cta-mayfly" href={pathWithAuthTarget("/login", target)}>
              进入工作台 <span aria-hidden="true">→</span>
            </ReliableLink>
            <ReliableLink className="start-secondary-link" href={pathWithAuthTarget("/register", target)}>
              创建账号
            </ReliableLink>
            <ReliableLink className="start-secondary-link" href="/about">
              功能说明
            </ReliableLink>
          </div>
        </section>
        <div className="start-page-footnote">Evidence · Flow · Practice · Review</div>
      </div>
    </main>
  );
}
