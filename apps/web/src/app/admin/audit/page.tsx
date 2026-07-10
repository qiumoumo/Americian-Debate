import { AdminShell } from "@/components/admin-shell";
import { SectionCard } from "@/components/section-card";
import { requireAdmin } from "@/lib/auth";
import { sessionShellUser } from "@/lib/session-props";
import { getAuditLogs } from "@/lib/audit";

const ACTION_LABELS: Record<string, string> = {
  "member.role_update": "修改成员角色",
  "member.invite": "邀请成员",
  "member.disable": "禁用账号",
  "member.enable": "启用账号",
  "member.remove": "移除成员",
  "ai.workspace_config_update": "修改 workspace AI",
  "workspace.create": "创建工作区",
  "workspace.rename": "重命名工作区",
  "workspace.archive": "归档工作区",
  "announcement.create": "发布公告",
  "announcement.update": "修改公告",
  "announcement.delete": "删除公告",
  "settings.update": "修改系统设置",
  "data.import": "导入数据"
};

function describeMeta(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  return Object.entries(meta as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("，");
}

export default async function AdminAuditPage() {
  const session = await requireAdmin();
  const logs = await getAuditLogs(session.workspace.id, 150);

  return (
    <AdminShell activeHref="/admin/audit" user={sessionShellUser(session)}>
      <section className="hero">
        <div className="eyebrow">Audit</div>
        <h1>操作审计日志</h1>
        <p>管理端的每一次写操作都会留痕。最近 150 条，倒序排列。当前工作区：{session.workspace.name}。</p>
      </section>

      <SectionCard title="操作记录" description="记录操作人、动作、对象与时间。">
        <div className="table-like admin-table audit-table">
          <div className="table-row header"><div>时间</div><div>操作人</div><div>动作</div><div>详情</div></div>
          {logs.map((log) => (
            <div className="table-row" key={log.id}>
              <div><small>{log.createdAt.toLocaleString()}</small></div>
              <div>{log.actorName ?? "—"}</div>
              <div><span className="pill">{ACTION_LABELS[log.action] ?? log.action}</span></div>
              <div><small>{[log.targetType, describeMeta(log.metaJson)].filter(Boolean).join(" · ")}</small></div>
            </div>
          ))}
          {logs.length === 0 ? <p className="empty-state">还没有审计记录。</p> : null}
        </div>
      </SectionCard>
    </AdminShell>
  );
}
