import { AdminShell } from "@/components/admin-shell";
import { AIConfigCommandForm } from "@/components/ai-config-command-form";
import { AIConfigForm } from "@/components/ai-config-form";
import { SectionCard } from "@/components/section-card";
import { getGlobalAIConfigs, isAIModelDiscoveryEnabled } from "@/lib/ai-config";
import { requireSystemAdmin } from "@/lib/auth";
import { getGlobalAIUsageLogs } from "@/lib/data";
import { sessionShellUser } from "@/lib/session-props";
import { getAIProviderConfigStatus } from "@debate/ai";
import {
  deleteGlobalAIConfigAction,
  fetchGlobalAIModelsAction,
  saveGlobalAIConfigAction,
  setDefaultGlobalAIConfigAction,
  testGlobalAIConnectionAction
} from "./actions";

export default async function AdminAiPage() {
  const session = await requireSystemAdmin();
  const [configs, aiLogs] = await Promise.all([
    getGlobalAIConfigs({ includeDisabled: true }),
    getGlobalAIUsageLogs()
  ]);
  const envStatus = getAIProviderConfigStatus();
  const modelDiscoveryEnabled = isAIModelDiscoveryEnabled();

  return (
    <AdminShell activeHref="/admin/ai" user={sessionShellUser(session)}>
      <section className="hero">
        <div className="eyebrow">AI</div>
        <h1>全局 AI 配置</h1>
        <p>维护所有注册用户可选的 AI。启用的配置会出现在客户端，默认项用于自动回退。</p>
      </section>

      <div className="grid two ai-admin-grid">
        <SectionCard title="添加全局 AI" description="API Key 加密保存在服务器，不会发送到客户端。">
          <AIConfigForm action={saveGlobalAIConfigAction} fetchModelsAction={fetchGlobalAIModelsAction} testConnectionAction={testGlobalAIConnectionAction} modelDiscoveryEnabled={modelDiscoveryEnabled} submitLabel="添加全局 AI" />
        </SectionCard>
        <SectionCard title="服务器兜底" description="没有可用的全局默认配置时使用。">
          <div className="table-like compact-table">
            <div className="table-row"><div><strong>Provider</strong></div><div>{envStatus.providerId}</div><div /></div>
            <div className="table-row"><div><strong>Model</strong></div><div>{envStatus.model || "—"}</div><div /></div>
            <div className="table-row"><div><strong>状态</strong></div><div><span className="pill">{envStatus.configured ? "已配置" : "需检查"}</span></div><div /></div>
          </div>
        </SectionCard>
      </div>

      <div style={{ height: 18 }} />

      <SectionCard title={`已保存的全局 AI（${configs.length}）`} description="客户端只能看到已启用项；同一时间恰有一套启用配置作为全局默认。">
        <div className="ai-config-list">
          {configs.map((config) => (
            <details className="ai-config-row" key={config.id}>
              <summary>
                <span className="ai-config-summary-main"><strong>{config.name}</strong><small>{config.providerId} · {config.model || "—"}</small></span>
                <span className="actions">
                  {config.isDefault ? <span className="pill">全局默认</span> : null}
                  <span className="pill">{config.enabled ? "已启用" : "已停用"}</span>
                  <span className="pill">Key {config.hasKey ? "已配置" : "未配置"}</span>
                </span>
              </summary>
              <div className="ai-config-editor">
                <AIConfigForm action={saveGlobalAIConfigAction} fetchModelsAction={fetchGlobalAIModelsAction} testConnectionAction={testGlobalAIConnectionAction} modelDiscoveryEnabled={modelDiscoveryEnabled} view={config} submitLabel="保存修改" />
                <div className="ai-config-commands">
                  {!config.isDefault && config.enabled ? (
                    <AIConfigCommandForm action={setDefaultGlobalAIConfigAction} configId={config.id} label="设为全局默认" pendingLabel="切换中…" />
                  ) : null}
                  <AIConfigCommandForm
                    action={deleteGlobalAIConfigAction}
                    configId={config.id}
                    label="删除配置"
                    pendingLabel="删除中…"
                    danger
                    confirmMessage={`确认删除“${config.name}”？使用它的用户将自动回退到全局默认。`}
                  />
                </div>
              </div>
            </details>
          ))}
          {configs.length === 0 ? <p className="empty-state">还没有全局 AI 配置。</p> : null}
        </div>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="全局 AI 用量" description="展示主机级全局与服务器兜底请求，不包含用户私有 AI。">
        <div className="table-like admin-table">
          <div className="table-row header"><div>Task</div><div>Provider / model</div><div>Tokens / cost</div></div>
          {aiLogs.map((log) => (
            <div className="table-row" key={log.id}>
              <div><strong>{log.taskType}</strong><br /><small>{log.createdAt.toLocaleString()} · {log.source ?? "env"}</small></div>
              <div>{log.provider}<br /><span className="pill">{log.model}</span></div>
              <div>in {log.inputTokenEstimate} / out {log.outputTokenEstimate}<br /><small>{log.costEstimateCents} cents est.</small></div>
            </div>
          ))}
          {aiLogs.length === 0 ? <p className="empty-state">还没有 AI 请求记录。</p> : null}
        </div>
      </SectionCard>
    </AdminShell>
  );
}
