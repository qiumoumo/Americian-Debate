import { AdminShell } from "@/components/admin-shell";
import { SectionCard } from "@/components/section-card";
import { AIConfigForm } from "@/components/ai-config-form";
import { requireAdmin } from "@/lib/auth";
import { sessionShellUser } from "@/lib/session-props";
import { getAdminDashboard } from "@/lib/data";
import { getWorkspaceAIConfigView } from "@/lib/ai-config";
import { getAIProviderConfigStatus } from "@debate/ai";
import { updateWorkspaceAIConfig } from "./actions";

export default async function AdminAiPage() {
  const session = await requireAdmin();
  const [workspaceConfig, dashboard] = await Promise.all([
    getWorkspaceAIConfigView(session.workspace.id),
    getAdminDashboard(session.workspace.id)
  ]);
  const canEdit = session.role === "OWNER";
  const envStatus = getAIProviderConfigStatus();

  return (
    <AdminShell activeHref="/admin/ai" user={sessionShellUser(session)}>
      <section className="hero">
        <div className="eyebrow">AI</div>
        <h1>AI 配置与审计</h1>
        <p>部署一套全员共用的 workspace AI；成员也可在「用户设置」里配置自己的私有 AI（对管理员不可见）。</p>
      </section>

      <div className="grid two">
        <SectionCard
          title="Workspace AI（全员共用）"
          description={canEdit ? "启用后，未配置私有 AI 的成员都会使用这套配置。密钥加密存储。" : "仅 OWNER 可修改；COACH 只读。"}
        >
          <AIConfigForm action={updateWorkspaceAIConfig} view={workspaceConfig} canEdit={canEdit} submitLabel="保存 workspace AI" />
        </SectionCard>

        <SectionCard title="解析优先级" description="每次 AI 请求按此顺序选择 provider。">
          <div className="timeline">
            <div className="timeline-item"><strong>1. 用户私有 AI</strong><p>成员自己配置且启用时优先使用，管理员不可见。</p></div>
            <div className="timeline-item"><strong>2. Workspace AI</strong><p>本页配置且启用时，作为全员默认。</p></div>
            <div className="timeline-item"><strong>3. 服务器环境变量</strong><p>兜底：.env.local 中的 AI_PROVIDER（当前：{envStatus.providerId}）。</p></div>
          </div>
        </SectionCard>
      </div>

      <div style={{ height: 18 }} />

      <SectionCard title="AI 用量审计" description="仅统计 workspace / 环境变量 AI 的用量；成员私有 AI 的用量不在此显示。">
        <div className="table-like admin-table">
          <div className="table-row header"><div>Task</div><div>Provider / model</div><div>Tokens / cost</div></div>
          {dashboard.aiLogs.map((log) => (
            <div className="table-row" key={log.id}>
              <div><strong>{log.taskType}</strong><br /><small>{log.createdAt.toLocaleString()} / {log.source ?? "env"}</small></div>
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
