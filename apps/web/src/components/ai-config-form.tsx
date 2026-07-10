import { AI_PROVIDER_CHOICES } from "@debate/ai";
import type { AIConfigView } from "@/lib/ai-config";

interface AIConfigFormProps {
  action: (formData: FormData) => void | Promise<void>;
  view: AIConfigView | null;
  /** When false the form renders read-only (no edit permission). */
  canEdit?: boolean;
  submitLabel?: string;
}

/**
 * Shared editor for an AI provider config. Used by the admin (workspace config)
 * and the user settings (personal config). The API key is write-only: it is
 * never sent back to the browser, only a "已配置" hint is shown.
 */
export function AIConfigForm({ action, view, canEdit = true, submitLabel = "保存配置" }: AIConfigFormProps) {
  if (!canEdit) {
    return (
      <div className="table-like">
        <div className="table-row"><div><strong>Provider</strong></div><div><span className="pill">{view?.providerId ?? "—"}</span></div><div>{view?.enabled ? "✅ 已启用" : "未启用"}</div></div>
        <div className="table-row"><div><strong>Model</strong></div><div>{view?.model || "—"}</div><div /></div>
        <div className="table-row"><div><strong>API Key</strong></div><div>{view?.hasKey ? "已配置" : "未配置"}</div><div /></div>
      </div>
    );
  }

  return (
    <form action={action} className="stack">
      <label className="field">
        <span>Provider</span>
        <select name="providerId" defaultValue={view?.providerId ?? "mock"}>
          {AI_PROVIDER_CHOICES.map((provider) => (
            <option value={provider.id} key={provider.id}>{provider.label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Model</span>
        <input name="model" type="text" defaultValue={view?.model ?? ""} placeholder="留空则用该 provider 的默认模型" />
      </label>
      <label className="field">
        <span>Base URL（仅自定义端点需要；已知第三方会自动填入）</span>
        <input name="baseUrl" type="text" defaultValue={view?.baseUrl ?? ""} placeholder="https://api.deepseek.com/v1" />
      </label>
      <label className="field">
        <span>API Key</span>
        <input name="apiKey" type="password" autoComplete="off" placeholder={view?.hasKey ? "已配置（留空则保持不变）" : "sk-..."} />
      </label>
      <label className="check-field">
        <input name="clearKey" type="checkbox" value="true" />
        <span>清除已保存的密钥</span>
      </label>
      <label className="check-field">
        <input name="enabled" type="checkbox" value="true" defaultChecked={view?.enabled ?? false} />
        <span>启用此配置</span>
      </label>
      <button className="button primary" type="submit">{submitLabel}</button>
    </form>
  );
}
