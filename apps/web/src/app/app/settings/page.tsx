import { AppShell } from "@/components/app-shell";
import { ProviderHealthCard } from "@/components/provider-health-card";
import { SectionCard } from "@/components/section-card";
import { AIConfigForm } from "@/components/ai-config-form";
import { getAIProviderConfigStatus } from "@debate/ai";
import { requireUser } from "@/lib/auth";
import { sessionShellUser } from "@/lib/session-props";
import { getUserAIConfigView, getWorkspaceAIConfigView } from "@/lib/ai-config";
import { updateUserAIConfig, updateUserAIPreference } from "./actions";

const providerRows = [
  ["AI_PROVIDER", "mock / openclaw / openai-compatible / anthropic"],
  ["OPENAI_COMPATIBLE_BASE_URL", "Generic OpenAI-compatible endpoint, such as DeepSeek /v1"],
  ["OPENAI_COMPATIBLE_API_KEY", "Server-side only; never exposed to browser"],
  ["OPENAI_COMPATIBLE_MODEL", "Generic OpenAI-compatible model name"],
  ["ANTHROPIC_API_KEY", "Anthropic key; server-side only"],
  ["ANTHROPIC_MODEL", "Default: claude-opus-4-8"]
];

export default async function SettingsPage() {
  const session = await requireUser();
  const [providerStatus, userConfig, workspaceConfig] = await Promise.all([
    Promise.resolve(getAIProviderConfigStatus()),
    getUserAIConfigView(session.user.id),
    getWorkspaceAIConfigView(session.workspace.id)
  ]);

  const preferredSource = userConfig?.preferredSource ?? "auto";
  const personalUsable = Boolean(userConfig?.enabled);
  const workspaceUsable = Boolean(workspaceConfig?.enabled);

  // 与 resolveAIProvider 同一套回退逻辑，保证"当前生效"与实际请求一致。
  const personalEffective = { source: "个人私有", providerId: userConfig?.providerId ?? "", model: userConfig?.model ?? "" };
  const workspaceEffective = { source: "工作区共用", providerId: workspaceConfig?.providerId ?? "", model: workspaceConfig?.model ?? "" };
  const envEffective = { source: "服务器默认", providerId: providerStatus.providerId, model: providerStatus.model };

  let effective: { source: string; providerId: string; model: string };
  if (preferredSource === "env") {
    effective = envEffective;
  } else if (preferredSource === "workspace") {
    effective = workspaceUsable ? workspaceEffective : envEffective;
  } else {
    // personal / auto：个人 → 工作区 → 服务器
    effective = personalUsable ? personalEffective : workspaceUsable ? workspaceEffective : envEffective;
  }

  const sourceOptions: Array<{ value: string; label: string; hint: string }> = [
    { value: "auto", label: "自动（按优先级）", hint: "个人 → 工作区 → 服务器" },
    { value: "personal", label: "我的私有 AI", hint: personalUsable ? "已启用" : "未配置/未启用，将回退" },
    { value: "workspace", label: "工作区共用 AI", hint: workspaceUsable ? "已启用" : "未配置/未启用，将回退到服务器默认" },
    { value: "env", label: "服务器默认", hint: `当前：${providerStatus.providerId}` }
  ];

  return (
    <AppShell
      activeHref="/app/settings"
      user={sessionShellUser(session)}
      note="配置你自己的私有 AI，或使用管理员部署的工作区 AI。API key 加密存储在服务器。"
    >
      <section className="hero">
        <div className="eyebrow">Settings</div>
        <h1>用户设置</h1>
        <p>
          你可以配置<strong>自己的私有 AI</strong>（仅你可见，管理员和其他成员都看不到），并选择<strong>实际使用哪一套已配置的 AI</strong>。不配置时会自动使用管理员部署的工作区 AI 或服务器默认。
        </p>
      </section>

      <SectionCard title="选择使用的 AI" description="决定你的 AI 请求实际走哪一套配置；所选来源不可用时会自动回退。">
        <form action={updateUserAIPreference} className="form-grid">
          <label className="field">
            <span>AI 来源</span>
            <select name="preferredSource" defaultValue={preferredSource}>
              {sourceOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}（{option.hint}）</option>
              ))}
            </select>
          </label>
          <button className="button primary" type="submit">保存选择</button>
        </form>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="当前生效的 AI" description="每次 AI 请求实际使用的 provider。">
        <div className="table-like">
          <div className="table-row"><div><strong>来源</strong></div><div><span className="pill">{effective.source}</span></div><div /></div>
          <div className="table-row"><div><strong>Provider</strong></div><div>{effective.providerId}</div><div /></div>
          <div className="table-row"><div><strong>Model</strong></div><div>{effective.model || "—"}</div><div /></div>
        </div>
      </SectionCard>

      <div style={{ height: 18 }} />

      <div className="grid two">
        <SectionCard title="我的私有 AI" description="启用后，你的 AI 请求将只走这套配置。密钥加密存储，不会下发浏览器，也对管理员不可见。">
          <AIConfigForm action={updateUserAIConfig} view={userConfig} submitLabel="保存我的 AI" />
        </SectionCard>

        <SectionCard title="AI provider health（服务器默认）" description="Mock mode works without a key; configured providers run only from server routes.">
          <ProviderHealthCard status={providerStatus} />
        </SectionCard>
      </div>

      <div style={{ height: 18 }} />

      <SectionCard title="服务器环境变量（管理员/运维）" description="服务器默认 AI 的兜底配置，位于项目根 .env.local，修改后需重启 dev server。">
        <div className="table-like">
          <div className="table-row header">
            <div>Variable</div>
            <div>Purpose</div>
            <div>Visibility</div>
          </div>
          {providerRows.map(([name, purpose]) => (
            <div className="table-row" key={name}>
              <div><strong>{name}</strong></div>
              <div>{purpose}</div>
              <div><span className="pill">server only</span></div>
            </div>
          ))}
        </div>
      </SectionCard>
    </AppShell>
  );
}
