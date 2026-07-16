import { AppShell } from "@/components/app-shell";
import { ReliableLink } from "@/components/reliable-link";
import { SectionCard } from "@/components/section-card";
import { StatCard } from "@/components/stat-card";
import { workspaceStats } from "@debate/shared";

const buildSteps = [
  "Phase 0: 初始化 monorepo、SQLite schema、AI provider 抽象。",
  "Phase 1: 文档 / evidence / Reference Bar / 比赛 flow / timer。",
  "Phase 2: AI 生成草稿、Practice Debate、赛后复盘。",
  "Phase 3+: 管理网站、云端协作、桌面发布。"
];

export default function HomePage() {
  return (
    <AppShell activeHref="/">
      <section className="hero">
        <div className="eyebrow">American Debate Workspace</div>
        <h1>美辩工作台</h1>
        <p>辩论资料、比赛和训练，一个本地优先的工作台。</p>
        <div className="actions">
          <ReliableLink className="button primary" href="/app/documents">进入用户端</ReliableLink>
          <ReliableLink className="button" href="/about">功能说明</ReliableLink>
        </div>
      </section>

      <div className="grid three">
        <StatCard label="Rounds tracked" value={String(workspaceStats.rounds)} note="本地 MVP 的比赛记录入口" />
        <StatCard label="Win rate" value={`${workspaceStats.winRate}%`} note="后续由结构化 outcomes 计算" />
        <StatCard label="Evidence cards" value={String(workspaceStats.evidenceCards)} note="每条卡片都有来源和标签" />
      </div>

      <div style={{ height: 18 }} />

      <SectionCard title="开发路线" description="从空项目开始，先做可运行骨架，再逐步替换成真实编辑器、数据库和 AI。">
        <div className="timeline">
          {buildSteps.map((step) => (
            <div className="timeline-item" key={step}>{step}</div>
          ))}
        </div>
      </SectionCard>
    </AppShell>
  );
}
