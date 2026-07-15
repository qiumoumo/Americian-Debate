"use client";

import { useActionState } from "react";
import type { AIConfigActionState } from "@/lib/ai-config";

interface SelectionOption {
  id: string;
  name: string;
  providerId: string;
  model: string;
  isDefault?: boolean;
}

interface AISelectionFormProps {
  action: (state: AIConfigActionState, formData: FormData) => Promise<AIConfigActionState>;
  defaultValue: string;
  globalOptions: SelectionOption[];
  personalOptions: SelectionOption[];
}

export function AISelectionForm({ action, defaultValue, globalOptions, personalOptions }: AISelectionFormProps) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  return (
    <form action={formAction} className="form-grid ai-selection-form">
      <label className="field">
        <span>当前 AI</span>
        <select name="selection" defaultValue={defaultValue}>
          <option value="AUTO">跟随全局默认</option>
          <option value="ENV">服务器默认</option>
          {globalOptions.length ? (
            <optgroup label="全局 AI">
              {globalOptions.map((option) => <option value={`CONFIG:${option.id}`} key={option.id}>{option.name} · {option.providerId} / {option.model}{option.isDefault ? "（默认）" : ""}</option>)}
            </optgroup>
          ) : null}
          {personalOptions.length ? (
            <optgroup label="我的私有 AI">
              {personalOptions.map((option) => <option value={`CONFIG:${option.id}`} key={option.id}>{option.name} · {option.providerId} / {option.model}</option>)}
            </optgroup>
          ) : null}
        </select>
      </label>
      <button className="button primary" type="submit" disabled={pending}>{pending ? "切换中…" : "保存选择"}</button>
      {state.message ? <p className={state.ok ? "form-success" : "form-error"} role="status">{state.message}</p> : null}
    </form>
  );
}
