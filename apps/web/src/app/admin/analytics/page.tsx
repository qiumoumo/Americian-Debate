import { AdminShell } from "@/components/admin-shell";
import { SectionCard } from "@/components/section-card";
import { StatCard } from "@/components/stat-card";
import { requireAdmin } from "@/lib/auth";
import { sessionShellUser } from "@/lib/session-props";
import { getAnalyticsDashboard, getWorkspaceMembers } from "@/lib/data";

function Meter({ label, value, suffix = "%" }: { label: string; value: number; suffix?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <strong>{value}{suffix}</strong>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function AdminAnalyticsPage() {
  const session = await requireAdmin();
  const members = await getWorkspaceMembers(session.workspace.id);
  const memberUserIds = members.map((m) => m.userId);
  const data = await getAnalyticsDashboard(session.workspace.id, memberUserIds);

  const maxTaskCount = Math.max(1, ...data.aiUsage.map((u) => u.count));

  return (
    <AdminShell activeHref="/admin/analytics" user={sessionShellUser(session)}>
      <section className="hero">
        <div className="eyebrow">Analytics</div>
        <h1>数据分析</h1>
        <p>基于真实比赛与 AI 日志。当前工作区：{session.workspace.name}。</p>
      </section>

      <div className="grid three">
        <StatCard label="比赛场次" value={String(data.matchCount)} note="workspace 总记录" />
        <StatCard label="总胜率" value={`${data.stats.winRate}%`} note={`${data.stats.rounds} 场中已判定`} />
        <StatCard label="训练次数" value={String(data.practiceTotal)} note="Practice sessions" />
      </div>

      <div style={{ height: 18 }} />

      <div className="grid two">
        <SectionCard title="胜率拆分" description="按正/反方分别统计的胜率。">
          <div className="meter-list">
            <Meter label="总胜率" value={data.stats.winRate} />
            <Meter label="Aff / Pro 胜率" value={data.stats.affWinRate} />
            <Meter label="Neg / Con 胜率" value={data.stats.negWinRate} />
          </div>
        </SectionCard>

        <SectionCard title="AI 用量概览" description="workspace / 环境 AI 的请求量与成本（不含成员私有 AI）。">
          <div className="grid two">
            <StatCard label="AI 请求" value={String(data.totalAiRequests)} note="近 500 条内" />
            <StatCard label="估算成本" value={`${data.totalAiCents}¢`} note="cost estimate" />
          </div>
        </SectionCard>
      </div>

      <div style={{ height: 18 }} />

      <SectionCard title="AI 用量（按任务类型）" description="各类 AI 任务的调用次数与 token 估算。">
        {data.aiUsage.length === 0 ? (
          <p className="empty-state">还没有 AI 用量数据。</p>
        ) : (
          <div className="meter-list">
            {data.aiUsage.map((usage) => (
              <div className="meter" key={usage.taskType}>
                <div className="meter-head">
                  <span>{usage.taskType}</span>
                  <strong>{usage.count} 次 · in {usage.inTokens} / out {usage.outTokens} · {usage.cents}¢</strong>
                </div>
                <div className="meter-track">
                  <div className="meter-fill" style={{ width: `${Math.round((usage.count / maxTaskCount) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </AdminShell>
  );
}
