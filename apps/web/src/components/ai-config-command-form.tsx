"use client";

import { useActionState } from "react";
import type { AIConfigActionState } from "@/lib/ai-config";

const initialState: AIConfigActionState = { ok: false, message: "" };

interface AIConfigCommandFormProps {
  action: (state: AIConfigActionState, formData: FormData) => Promise<AIConfigActionState>;
  configId: string;
  label: string;
  pendingLabel: string;
  danger?: boolean;
  confirmMessage?: string;
}

export function AIConfigCommandForm({ action, configId, label, pendingLabel, danger, confirmMessage }: AIConfigCommandFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form
      action={formAction}
      className="inline-action-form"
      onSubmit={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      <input type="hidden" name="configId" value={configId} />
      <button className={`button${danger ? " danger" : ""}`} type="submit" disabled={pending}>{pending ? pendingLabel : label}</button>
      {state.message ? <small className={state.ok ? "form-success" : "form-error"} role="status">{state.message}</small> : null}
    </form>
  );
}
