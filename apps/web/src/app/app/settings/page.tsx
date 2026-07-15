import { AppShell } from "@/components/app-shell";
import { AIConfigCommandForm } from "@/components/ai-config-command-form";
import { AIConfigForm } from "@/components/ai-config-form";
import { AISelectionForm } from "@/components/ai-selection-form";
import { ProviderHealthCard } from "@/components/provider-health-card";
import { SectionCard } from "@/components/section-card";
import { getGlobalAIConfigs, getUserAIConfigs, getUserAISelection, isAIModelDiscoveryEnabled } from "@/lib/ai-config";
import { requireUser } from "@/lib/auth";
import { sessionShellUser } from "@/lib/session-props";
import { getAIProviderConfigStatus } from "@debate/ai";
import {
  deletePersonalAIConfigAction,
  fetchPersonalAIModelsAction,
  savePersonalAIConfigAction,
  testPersonalAIConnectionAction,
  updateUserAISelectionAction
} from "./actions";

export default async function SettingsPage() {
  const session = await requireUser();
  const [providerStatus, globalConfigs, personalConfigs, selection] = await Promise.all([
    Promise.resolve(getAIProviderConfigStatus()),
    getGlobalAIConfigs(),
    getUserAIConfigs(session.user.id),
    getUserAISelection(session.user.id)
  ]);
  const enabledPersonal = personalConfigs.filter((config) => config.enabled);
  const modelDiscoveryEnabled = isAIModelDiscoveryEnabled();
  const selected = selection.mode === "CONFIG"
    ? [...globalConfigs, ...enabledPersonal].find((config) => config.id === selection.configId)
    : null;
  const fallbackGlobal = globalConfigs.find((config) => config.isDefault);
  const effective = selection.mode === "ENV"
    ? { source: "服务器默认", name: "服务器环境变量", providerId: providerStatus.providerId, model: providerStatus.model }
    : selected
      ? { source: selected.scope === "GLOBAL" ? "全局 AI" : "我的私有 AI", name: selected.name, providerId: selected.providerId, model: selected.model }
      : fallbackGlobal
        ? { source: "全局默认", name: fallbackGlobal.name, providerId: fallbackGlobal.providerId, model: fallbackGlobal.model }
        : { source: "服务器默认", name: "服务器环境变量", providerId: providerStatus.providerId, model: providerStatus.model };
  const selectionValue = selection.mode === "CONFIG" && selection.configId ? `CONFIG:${selection.configId}` : selection.mode;
  const toOption = (config: (typeof globalConfigs)[number]) => ({
    id: config.id,
    name: config.name,
    providerId: config.providerId,
    model: config.model,
    isDefault: config.isDefault
  });

  return (
    <AppShell
      activeHref="/app/settings"
      user={sessionShellUser(session)}
      note="选择全局 AI，或添加仅你可见的私有 AI。API Key 始终保存在服务器。"
    >
      <section className="hero">
        <div className="eyebrow">Settings</div>
        <h1>AI 设置</h1>
        <p>你可以在管理员提供的全局 AI 与自己的私有配置之间自由切换。</p>
      </section>

      <div className="grid two">
        <SectionCard title="选择使用的 AI" description="所选配置不可用时，自动回退到全局默认，再回退服务器默认。">
          <AISelectionForm
            action={updateUserAISelectionAction}
            defaultValue={selectionValue}
            globalOptions={globalConfigs.map(toOption)}
            personalOptions={enabledPersonal.map(toOption)}
          />
        </SectionCard>
        <SectionCard title="当前生效" description="下一次 AI 请求将使用这套配置。">
          <div className="table-like compact-table">
            <div className="table-row"><div><strong>来源</strong></div><div><span className="pill">{effective.source}</span></div><div /></div>
            <div className="table-row"><div><strong>名称</strong></div><div>{effective.name}</div><div /></div>
            <div className="table-row"><div><strong>Provider</strong></div><div>{effective.providerId}</div><div /></div>
            <div className="table-row"><div><strong>Model</strong></div><div>{effective.model || "—"}</div><div /></div>
          </div>
        </SectionCard>
      </div>

      <div style={{ height: 18 }} />

      <div className="grid two ai-settings-grid">
        <SectionCard title="添加我的私有 AI" description="配置仅你可见；管理员和其他用户无法读取。">
          <AIConfigForm action={savePersonalAIConfigAction} fetchModelsAction={fetchPersonalAIModelsAction} testConnectionAction={testPersonalAIConnectionAction} modelDiscoveryEnabled={modelDiscoveryEnabled} submitLabel="添加私有 AI" />
        </SectionCard>
        <SectionCard title={`可用的全局 AI（${globalConfigs.length}）`} description="全局 API Key 和端点信息不会显示。">
          <div className="ai-public-config-list">
            {globalConfigs.map((config) => (
              <div className="ai-public-config-row" key={config.id}>
                <div><strong>{config.name}</strong><small>{config.providerId} · {config.model || "—"}</small></div>
                {config.isDefault ? <span className="pill">默认</span> : null}
              </div>
            ))}
            {globalConfigs.length === 0 ? <p className="empty-state">管理员尚未启用全局 AI。</p> : null}
          </div>
        </SectionCard>
      </div>

      <div style={{ height: 18 }} />

      <SectionCard title={`我的私有 AI（${personalConfigs.length}）`} description="停用的配置会继续保存，但不会出现在选择列表中。">
        <div className="ai-config-list">
          {personalConfigs.map((config) => (
            <details className="ai-config-row" key={config.id}>
              <summary>
                <span className="ai-config-summary-main"><strong>{config.name}</strong><small>{config.providerId} · {config.model || "—"}</small></span>
                <span className="actions">
                  <span className="pill">{config.enabled ? "已启用" : "已停用"}</span>
                  <span className="pill">Key {config.hasKey ? "已配置" : "未配置"}</span>
                </span>
              </summary>
              <div className="ai-config-editor">
                <AIConfigForm action={savePersonalAIConfigAction} fetchModelsAction={fetchPersonalAIModelsAction} testConnectionAction={testPersonalAIConnectionAction} modelDiscoveryEnabled={modelDiscoveryEnabled} view={config} submitLabel="保存修改" />
                <div className="ai-config-commands">
                  <AIConfigCommandForm
                    action={deletePersonalAIConfigAction}
                    configId={config.id}
                    label="删除配置"
                    pendingLabel="删除中…"
                    danger
                    confirmMessage={`确认删除“${config.name}”？如果正在使用，将自动回退到全局默认。`}
                  />
                </div>
              </div>
            </details>
          ))}
          {personalConfigs.length === 0 ? <p className="empty-state">还没有私有 AI 配置。</p> : null}
        </div>
      </SectionCard>

      <div style={{ height: 18 }} />
      <SectionCard title="服务器默认 AI" description="全局配置不可用时的最后兜底。">
        <ProviderHealthCard status={providerStatus} />
      </SectionCard>
    </AppShell>
  );
}
