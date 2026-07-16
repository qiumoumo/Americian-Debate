"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatConfigs, normalizeSharedTimer, type SharedTimerState, type Side } from "@debate/shared";

interface RoomSnapshot {
  roomId: string;
  inviteCode: string;
  ownerId: string;
  revision: number;
  timer: SharedTimerState;
  timerStartedAt: number | null;
  members: Array<{ id: string; name: string }>;
}

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function MatchRoomRealtime({ matchId, initialRevision }: { matchId: string; initialRevision: number }) {
  const router = useRouter();
  const revisionRef = useRef(initialRevision);
  const connectionRef = useRef<{ roomId: string; connectionToken: string } | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [now, setNow] = useState(Date.now());
  const [displaced, setDisplaced] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function enter() {
      const response = await fetch(`/api/rooms/${matchId}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "enter" })
      });
      if (response.ok && !stopped) connectionRef.current = await response.json();
    }
    async function poll() {
      const response = await fetch(`/api/rooms/${matchId}`, { cache: "no-store" }).catch(() => null);
      if (!response?.ok || stopped) return;
      const next = await response.json() as RoomSnapshot;
      setSnapshot(next);
      if (next.revision !== revisionRef.current) {
        revisionRef.current = next.revision;
        router.refresh();
      }
    }
    async function heartbeat() {
      const connection = connectionRef.current;
      if (!connection || stopped) return;
      const response = await fetch(`/api/rooms/${matchId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "heartbeat", ...connection })
      }).catch(() => null);
      if (response?.status === 409) {
        setDisplaced(true);
        connectionRef.current = null;
      }
    }
    enter().then(poll);
    const pollId = window.setInterval(poll, 1_500);
    const heartbeatId = window.setInterval(heartbeat, 10_000);
    const clockId = window.setInterval(() => setNow(Date.now()), 200);
    return () => { stopped = true; window.clearInterval(pollId); window.clearInterval(heartbeatId); window.clearInterval(clockId); };
  }, [matchId, router]);

  const effectiveTimer = useMemo(() => snapshot
    ? normalizeSharedTimer(snapshot.timer, now, snapshot.timerStartedAt).state
    : null, [snapshot, now]);

  async function saveTimer(timer: SharedTimerState, startedAtMs: number | null) {
    setSnapshot((current) => current ? { ...current, timer, timerStartedAt: startedAtMs } : current);
    await fetch(`/api/rooms/${matchId}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "timer", timer, startedAtMs })
    });
  }

  if (!snapshot || !effectiveTimer) return <p className="small-note">正在连接比赛房间...</p>;
  const config = formatConfigs[effectiveTimer.format] ?? formatConfigs.PF;
  const speech = config.speeches[effectiveTimer.speechIndex] ?? config.speeches[0];
  const prepSides = Object.keys(config.prepBySide) as Side[];

  return (
    <div className="room-live-panel">
      {displaced ? <p className="status-error">此账号已在另一个房间上线，本页停止同步。</p> : null}
      <div className="room-meta-row">
        <div><span className="small-note">邀请码</span><strong className="room-code">{snapshot.inviteCode}</strong></div>
        <div><span className="small-note">在线成员</span><div className="actions">{snapshot.members.map((member) => <span className="pill" key={member.id}>{member.name}</span>)}</div></div>
      </div>
      <div className="timer-face" aria-label={`共享计时器 ${formatTime(effectiveTimer.remainingMs)}`}>
        <span className="timer-stage">{effectiveTimer.mode === "prep" ? `Prep (${effectiveTimer.prepSide})` : speech?.speech}</span>
        <strong>{formatTime(effectiveTimer.remainingMs)}</strong>
        <span className="timer-hint">房间共享计时器</span>
      </div>
      <div className="actions timer-actions">
        <button className="button primary" type="button" disabled={displaced} onClick={() => {
          if (effectiveTimer.running) saveTimer({ ...effectiveTimer, running: false }, null);
          else saveTimer({ ...effectiveTimer, running: true }, Date.now());
        }}>{effectiveTimer.running ? "暂停" : "开始"}</button>
        <button className="button" type="button" disabled={displaced} onClick={() => {
          const remainingMs = effectiveTimer.mode === "prep"
            ? config.prepBySide[effectiveTimer.prepSide] ?? 0
            : speech?.durationMs ?? 0;
          const prepRemaining = effectiveTimer.mode === "prep"
            ? { ...effectiveTimer.prepRemaining, [effectiveTimer.prepSide]: remainingMs }
            : effectiveTimer.prepRemaining;
          saveTimer({ ...effectiveTimer, remainingMs, prepRemaining, running: false }, null);
        }}>重置</button>
        <button className="button" type="button" disabled={displaced || effectiveTimer.speechIndex >= config.speeches.length - 1} onClick={() => {
          const index = Math.min(effectiveTimer.speechIndex + 1, config.speeches.length - 1);
          saveTimer({ ...effectiveTimer, mode: "speech", speechIndex: index, remainingMs: config.speeches[index]?.durationMs ?? 0, running: false }, null);
        }}>下一段</button>
      </div>
      <div className="actions timer-prep-row">
        {prepSides.map((side) => <button className={`button${effectiveTimer.mode === "prep" && effectiveTimer.prepSide === side ? " primary" : ""}`} type="button" key={side} onClick={() => saveTimer({ ...effectiveTimer, mode: "prep", prepSide: side, remainingMs: effectiveTimer.prepRemaining[side] ?? 0, running: false }, null)}>Prep {side} · {formatTime(effectiveTimer.prepRemaining[side] ?? 0)}</button>)}
      </div>
    </div>
  );
}
