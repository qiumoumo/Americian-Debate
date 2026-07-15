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
    const response = await fetch("/api/room-invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitationId: invitation.id, accept })
    });
    const payload = await response.json() as { matchId?: string };
    setInvitation(null);
    setBusy(false);
    if (accept && payload.matchId) router.push(`/app/matches?match=${payload.matchId}`);
  }

  if (!invitation) return null;
  return (
    <div className="room-invite-overlay" role="dialog" aria-modal="true" aria-label="比赛房间邀请">
      <div className="room-invite-dialog">
        <strong>{invitation.inviterName} 邀请你加入比赛房间</strong>
        <h2>{invitation.matchTitle}</h2>
        <p>{invitation.topic}</p>
        <p className="small-note">接受后会离开当前房间的在线状态并进入此房间。</p>
        <div className="actions">
          <button className="button primary" type="button" disabled={busy} onClick={() => respond(true)}>接受并进入</button>
          <button className="button" type="button" disabled={busy} onClick={() => respond(false)}>拒绝</button>
        </div>
      </div>
    </div>
  );
}
