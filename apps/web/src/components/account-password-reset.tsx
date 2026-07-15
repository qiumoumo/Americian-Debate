"use client";

import { useActionState } from "react";
import { resetGlobalAccountPasswordAction, type PasswordResetState } from "@/app/admin/accounts/actions";

const initialState: PasswordResetState = {};

export function AccountPasswordReset({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(resetGlobalAccountPasswordAction, initialState);
  return (
    <div className="account-reset-control">
      <form action={action}>
        <input type="hidden" name="userId" value={userId} />
        <button className="button" type="submit" disabled={pending}>{pending ? "正在重置..." : "重置密码"}</button>
      </form>
      {state.temporaryPassword ? (
        <div className="temporary-password" role="status">
          <span>一次性临时密码</span>
          <code>{state.temporaryPassword}</code>
          <small>此密码不会再次显示；用户登录后必须立即修改。</small>
        </div>
      ) : null}
      {state.error ? <small className="status-error">{state.error}</small> : null}
    </div>
  );
}
