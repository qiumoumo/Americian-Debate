"use client";

import { useActionState } from "react";
import { AI_PROVIDER_CHOICES } from "@debate/ai";
import type { AIConfigActionState, AIConfigView } from "@/lib/ai-config";

const initialState: AIConfigActionState = { ok: false, message: "" };

interface AIConfigFormProps {
  action: (state: AIConfigActionState, formData: FormData) => Promise<AIConfigActionState>;
  view?: AIConfigView | null;
  submitLabel?: string;
}

export function AIConfigForm({ action, view, submitLabel = "保存配置" }: AIConfigFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="stack">
      {view ? <input type="hidden" name="id" value={view.id} /> : null}
      <label className="field">
        <span>配置名称</span>
        <input name="name" type="text" defaultValue={view?.name ?? ""} placeholder="例如：团队 DeepSeek" aria-invalid={Boolean(error("name"))} />
        {error("name") ? <small className="form-error">{error("name")}</small> : null}
      </label>
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
        <input name="model" type="text" defaultValue={view?.model ?? ""} placeholder="预设 provider 可留空" aria-invalid={Boolean(error("model"))} />
        {error("model") ? <small className="form-error">{error("model")}</small> : null}
      </label>
      <label className="field">
        <span>Base URL</span>
        <input name="baseUrl" type="url" defaultValue={view?.baseUrl ?? ""} placeholder="https://api.example.com/v1" aria-invalid={Boolean(error("baseUrl"))} />
        {error("baseUrl") ? <small className="form-error">{error("baseUrl")}</small> : null}
      </label>
      <label className="field">
        <span>API Key</span>
        <input name="apiKey" type="password" autoComplete="off" placeholder={view?.hasKey ? "已配置（留空保持不变）" : "sk-..."} aria-invalid={Boolean(error("apiKey"))} />
        {error("apiKey") ? <small className="form-error">{error("apiKey")}</small> : null}
      </label>
      {view?.hasKey ? (
        <label className="check-field">
          <input name="clearKey" type="checkbox" value="true" />
          <span>清除已保存的密钥</span>
        </label>
      ) : null}
      <label className="check-field">
        <input name="enabled" type="checkbox" value="true" defaultChecked={view?.enabled ?? true} />
        <span>启用此配置</span>
      </label>
      {state.message ? <p className={state.ok ? "form-success" : "form-error"} role="status">{state.message}</p> : null}
      <button className="button primary" type="submit" disabled={pending}>{pending ? "保存中…" : submitLabel}</button>
    </form>
  );
}
