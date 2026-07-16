"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface PendingInvitation {
  id: string;
  inviterName: string;
  matchTitle: string;
  topic: string;
}

export function PresenceAgent() {
  const router = useRouter();
  const [invitation, setInvitation] = useState<PendingInvitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const heartbeat = () => fetch("/api/presence", { method: "POST" }).catch(() => undefined);
    heartbeat();
    const heartbeatId = window.setInterval(heartbeat, 10_000);
    const poll = async () => {
      const response = await fetch("/api/room-invitations", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const payload = await response.json() as { invitation: PendingInvitation | null };
      setInvitation(payload.invitation);
    };
    poll();
    const inviteId = window.setInterval(poll, 2_000);
    return () => { window.clearInterval(heartbeatId); window.clearInterval(inviteId); };
  }, []);

  async function respond(accept: boolean) {
    if (!invitation) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/room-invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invitationId: invitation.id, accept })
      });
      const payload = await response.json() as { matchId?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "邀请处理失败");
      setInvitation(null);
      if (accept && payload.matchId) router.push(`/app/matches?match=${payload.matchId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "邀请处理失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  if (!invitation) return null;
  return (
    <div className="room-invite-stack" aria-live="polite" aria-label="比赛房间邀请">
      <aside className="room-invite-dialog">
        <strong>{invitation.inviterName} 邀请你加入比赛房间</strong>
        <h2>{invitation.matchTitle}</h2>
        <p>{invitation.topic}</p>
        <p className="small-note">接受后会离开当前房间的在线状态并进入此房间。</p>
        {error ? <p className="status-error">{error}</p> : null}
        <div className="actions">
          <button className="button primary" type="button" disabled={busy} onClick={() => respond(true)}>接受并进入</button>
          <button className="button" type="button" disabled={busy} onClick={() => respond(false)}>拒绝</button>
        </div>
      </aside>
    </div>
  );
}
