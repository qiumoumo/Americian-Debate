"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LibraryRoundRecord } from "@debate/shared";
import { deleteRound, restoreRound } from "@/app/app/library/actions";
import { LibraryModal, LibraryRoundForm } from "@/components/library-round-form";
import { ReliableLink } from "@/components/reliable-link";

export function LibraryRoundDetailActions({ round, canManage }: { round: LibraryRoundRecord; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [seconds, setSeconds] = useState(5);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!deleted) return;
    const expiresAt = Date.now() + 5000;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSeconds(remaining);
      if (remaining === 0) { window.clearInterval(timer); router.push("/app/library"); }
    }, 100);
    return () => window.clearInterval(timer);
  }, [deleted, router]);
  function confirmDelete() {
    const formData = new FormData();
    formData.set("roundId", round.id);
    startTransition(async () => {
      const result = await deleteRound(formData);
      if (result.ok) { setDeleting(false); setSeconds(5); setDeleted(true); } else setError(result.message);
    });
  }
  if (deleted) {
    return <div className="library-detail-deleted" role="status"><strong>素材已删除</strong><span>这份素材已从工作区隐藏。</span><span className="document-delete-toast-timer">{seconds}s</span><div className="actions"><button className="button" type="button" disabled={pending} onClick={() => { const formData = new FormData(); formData.set("roundId", round.id); startTransition(async () => { const result = await restoreRound(formData); if (result.ok) setDeleted(false); else setError(result.message); }); }}>{pending ? "恢复中..." : "撤回"}</button><ReliableLink className="button primary" href="/app/library">返回素材库</ReliableLink></div>{error ? <p className="status-error" role="alert">{error}</p> : null}</div>;
  }
  return <>
    <div className="actions library-detail-actions"><ReliableLink className="button" href="/app/library">← 返回素材库</ReliableLink>{canManage ? <button className="button primary" type="button" onClick={() => setEditing(true)}>编辑素材</button> : <span className="pill">仅发布者可编辑</span>}{canManage ? <button className="button danger" type="button" onClick={() => { setError(""); setDeleting(true); }}>删除</button> : null}</div>
    {editing ? <LibraryModal title="编辑比赛素材" onClose={() => !pending && setEditing(false)}><LibraryRoundForm round={round} onCancel={() => setEditing(false)} onDone={(result) => { if (result.ok) { setEditing(false); router.refresh(); } }} /></LibraryModal> : null}
    {deleting ? <LibraryModal title="删除比赛素材" onClose={() => !pending && setDeleting(false)}><p>确定删除这份素材吗？它会从工作区列表中隐藏。</p><p><strong data-language-raw>{round.title}</strong></p>{error ? <p className="status-error" role="alert">{error}</p> : null}<div className="document-modal-actions"><button className="button" type="button" onClick={() => setDeleting(false)} disabled={pending}>取消</button><button className="button danger" type="button" onClick={confirmDelete} disabled={pending}>{pending ? "删除中..." : "确认删除"}</button></div></LibraryModal> : null}
  </>;
}
