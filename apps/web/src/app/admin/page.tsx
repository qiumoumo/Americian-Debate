import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { SectionCard } from "@/components/section-card";
import { StatCard } from "@/components/stat-card";
import { getAdminDashboard } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { sessionShellUser } from "@/lib/session-props";
import { getAIProviderConfigStatus } from "@debate/ai";

const quickLinks = [
  { href: "/admin/members", title: "成员与账号", desc: "邀请、角色、重置密码、禁用/移除" },
  { href: "/admin/analytics", title: "数据分析", desc: "胜率、正反方表现、用量趋势" },
  { href: "/admin/ai", title: "AI 配置与审计", desc: "workspace AI 部署与用量审计" },
  { href: "/admin/workspaces", title: "工作区管理", desc: "创建、重命名、归档、切换" },
  { href: "/admin/settings", title: "公告与设置", desc: "公告、注册开关、密码策略" },
  { href: "/admin/audit", title: "审计日志", desc: "管理操作留痕" },
  { href: "/admin/data", title: "数据管理", desc: "导出 / 导入 / 备份" }
];

export default async function AdminPage() {
  const session = await requireAdmin();
  const dashboard = await getAdminDashboard(session.workspace.id);
  const aiStatus = getAIProviderConfigStatus();

  return (
    <AdminShell activeHref="/admin" user={sessionShellUser(session)}>
      <section className="hero">
        <div className="eyebrow">Admin</div>
        <h1>管理端概览</h1>
        <p>队伍、权限、资料库与 AI 使用审计的总入口。当前工作区：{session.workspace.name}。</p>
      </section>

      <div className="grid three">
        <StatCard label="Members" value={String(dashboard.memberships.length)} note="当前工作区成员" />
        <StatCard label="Documents" value={String(dashboard.counts.documentCount)} note="workspace 资料文件" />
        <StatCard label="Evidence" value={String(dashboard.counts.evidenceCount)} note="结构化 evidence cards" />
      </div>

      <div style={{ height: 18 }} />

      <SectionCard title="管理模块" description="点击进入各管理页面。">
        <div className="grid two">
          {quickLinks.map((link) => (
            <Link className="quick-link" href={link.href} key={link.href}>
              <strong>{link.title}</strong>
              <span>{link.desc}</span>
            </Link>
          ))}
        </div>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="AI provider 状态" description="当前生效的默认 AI 配置摘要；完整配置见「AI 配置」页。">
        <div className="table-like admin-table">
          <div className="table-row">
            <div><strong>Provider</strong></div>
            <div><span className="pill">{aiStatus.providerId}</span></div>
            <div>{aiStatus.configured ? "✅ 已配置" : "⚠️ 未配置完整"}</div>
          </div>
          <div className="table-row">
            <div><strong>Model</strong></div>
            <div>{aiStatus.model || "—"}</div>
            <div><small>{aiStatus.keyLocation}</small></div>
          </div>
        </div>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="AI usage audit" description="所有 AI route 都应写入 AIRequestLog；这里展示最近 10 条。">
        <div className="table-like admin-table">
          <div className="table-row header"><div>Task</div><div>Provider / model</div><div>Tokens / cost</div></div>
          {dashboard.aiLogs.map((log) => (
            <div className="table-row" key={log.id}>
              <div><strong>{log.taskType}</strong><br /><small>{log.createdAt.toLocaleString()} / {log.requestStatus}</small></div>
              <div>{log.provider}<br /><span className="pill">{log.model}</span></div>
              <div>in {log.inputTokenEstimate} / out {log.outputTokenEstimate}<br /><small>{log.costEstimateCents} cents est.</small></div>
            </div>
          ))}
          {dashboard.aiLogs.length === 0 ? <p className="empty-state">还没有 AI 请求日志。</p> : null}
        </div>
      </SectionCard>
    </AdminShell>
  );
}
