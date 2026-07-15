"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import { AI_PROVIDER_CHOICES } from "@debate/ai";
import type { AIConfigActionState, AIConfigView, AIEndpointActionState } from "@/lib/ai-config";

const initialState: AIConfigActionState = { ok: false, message: "" };

interface AIConfigFormProps {
  action: (state: AIConfigActionState, formData: FormData) => Promise<AIConfigActionState>;
  fetchModelsAction: (formData: FormData) => Promise<AIEndpointActionState>;
  testConnectionAction: (formData: FormData) => Promise<AIEndpointActionState>;
  modelDiscoveryEnabled: boolean;
  view?: AIConfigView | null;
  submitLabel?: string;
}

export function AIConfigForm({ action, fetchModelsAction, testConnectionAction, modelDiscoveryEnabled, view, submitLabel = "保存配置" }: AIConfigFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [probeState, setProbeState] = useState<AIEndpointActionState | null>(null);
  const [probeKind, setProbeKind] = useState<"models" | "connection" | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [probing, startProbe] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const modelListId = `ai-models-${useId().replace(/:/g, "")}`;
  const error = (field: string) => probeState?.fieldErrors?.[field] ?? state.fieldErrors?.[field];

  function runProbe(kind: "models" | "connection") {
    if (kind === "models" && !modelDiscoveryEnabled) {
      setProbeKind("models");
      setProbeState({ ok: false, message: "此功能需要服务器接入公网。如有条件，请联系技术人员解封。" });
      return;
    }
    const form = formRef.current;
    if (!form) return;
    setProbeKind(kind);
    setProbeState(null);
    startProbe(async () => {
      const result = await (kind === "models" ? fetchModelsAction : testConnectionAction)(new FormData(form));
      setProbeState(result);
      if (!result.ok) return;
      if (result.models?.length) {
        setModels(result.models);
        const modelInput = form.elements.namedItem("model") as HTMLInputElement | null;
        if (modelInput && !modelInput.value) modelInput.value = result.models[0] ?? "";
      }
      if (result.baseUrl) {
        const baseUrlInput = form.elements.namedItem("baseUrl") as HTMLInputElement | null;
        const providerInput = form.elements.namedItem("providerId") as HTMLSelectElement | null;
        const shouldFillBaseUrl = Boolean(baseUrlInput?.value) || providerInput?.value === "openai-compatible" || providerInput?.value === "openclaw";
        if (baseUrlInput && shouldFillBaseUrl) baseUrlInput.value = result.baseUrl;
      }
    });
  }

  return (
    <form action={formAction} className="stack" ref={formRef} onSubmit={() => setProbeState(null)}>
      {view ? <input type="hidden" name="id" value={view.id} /> : null}
      <details className="ai-config-example">
        <summary>查看填写示例</summary>
        <dl>
          <div><dt>Provider</dt><dd>自定义 OpenAI 兼容端点</dd></div>
          <div><dt>Base URL</dt><dd><code>https://api.example.com/v1</code></dd></div>
          <div><dt>API Key</dt><dd><code>sk-example-not-a-real-key</code></dd></div>
          <div><dt>Model</dt><dd><code>example-chat-model</code></dd></div>
        </dl>
      </details>
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
        <input name="model" type="text" list={modelListId} defaultValue={view?.model ?? ""} placeholder="获取模型后可直接选择" aria-invalid={Boolean(error("model"))} />
        <datalist id={modelListId}>{models.map((model) => <option value={model} key={model} />)}</datalist>
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
      <div className="ai-probe-actions">
        <button
          className={`button${modelDiscoveryEnabled ? "" : " is-locked"}`}
          type="button"
          disabled={probing}
          aria-disabled={!modelDiscoveryEnabled || probing}
          onClick={() => runProbe("models")}
        >
          {probing && probeKind === "models" ? "获取中…" : "获取模型"}
        </button>
        <button className="button" type="button" disabled={probing} onClick={() => runProbe("connection")}>{probing && probeKind === "connection" ? "测试中…" : "测试连接"}</button>
      </div>
      <small className="ai-connection-cost-note">测试连接会发送一次极小的真实模型请求，可能产生少量费用。</small>
      {probeState?.message ? <p className={probeState.ok ? "form-success" : "form-error"} role="status">{probeState.message}</p> : null}
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
