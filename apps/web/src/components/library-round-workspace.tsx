"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LibraryRoundRecord } from "@debate/shared";
import { deleteRound, restoreRound, type LibraryActionResult } from "@/app/app/library/actions";
import { ReliableLink } from "@/components/reliable-link";
import { LibraryModal, LibraryRoundCreateModal, LibraryRoundForm, RoundTagSuggestions } from "@/components/library-round-form";

interface LibraryRoundListItem extends LibraryRoundRecord {
  canManage: boolean;
}

export function LibraryRoundWorkspace({ rounds, canCreate }: { rounds: LibraryRoundListItem[]; canCreate: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LibraryRoundRecord | null>(null);
  const [deleting, setDeleting] = useState<LibraryRoundListItem | null>(null);
  const [undoTarget, setUndoTarget] = useState<LibraryRoundListItem | null>(null);
  const [seconds, setSeconds] = useState(5);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!undoTarget) return;
    const expiresAt = Date.now() + 5000;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSeconds(remaining);
      if (remaining === 0) { window.clearInterval(timer); setUndoTarget(null); }
    }, 100);
    return () => window.clearInterval(timer);
  }, [undoTarget]);

  function confirmDelete() {
    if (!deleting) return;
    const formData = new FormData();
    formData.set("roundId", deleting.id);
    startTransition(async () => {
      const result = await deleteRound(formData);
      if (result.ok) { setUndoTarget(deleting); setDeleting(null); router.refresh(); }
      else setMessage(result.message);
    });
  }

  return (
    <section className="library-index" aria-labelledby="library-index-title">
      <RoundTagSuggestions />
      <header className="library-index-head">
        <div className="library-index-title-block">
          <div className="library-index-kicker"><span className="library-index-kicker-dot" aria-hidden="true" />WORKSPACE / ROUND LIBRARY</div>
          <h1 id="library-index-title">比赛素材库</h1>
          <p>把值得复盘的比赛录像集中保存，和工作区成员共享一份可检索的观看档案。</p>
        </div>
        <div className="library-index-head-action">
          <span className="library-index-count"><strong>{String(rounds.length).padStart(2, "0")}</strong><span>份素材</span></span>
          {canCreate ? <button className="button primary library-create-button" type="button" onClick={() => setCreating(true)}><span aria-hidden="true">+</span>新增素材</button> : <span className="pill">只读</span>}
        </div>
      </header>
      <div className="library-list-head" aria-hidden="true"><span>ROUNDS / {String(rounds.length).padStart(2, "0")}</span><span>最近更新</span></div>
      <div className="library-list" aria-label="比赛素材列表">
        {rounds.map((round, index) => (
          <article className="library-list-row" key={round.id}>
            <span className="library-row-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <div className="library-list-copy">
              <strong data-language-raw>{round.title}</strong>
              <span className="library-format-badge">{round.format}</span>
              <p data-language-raw>{[round.teams, round.topic].filter(Boolean).join(" · ") || "暂无题目或队伍信息"}</p>
            </div>
            <div className="library-list-meta"><span>{round.updatedAt.slice(0, 10)}</span><span>{round.createdByName ? `发布者：${round.createdByName}` : "历史发布者"}</span></div>
            <div className="library-list-actions">
              <ReliableLink className="button primary library-open-button" href={`/app/library/${round.id}`}>查看 <span aria-hidden="true">↗</span></ReliableLink>
              {round.canManage ? <button className="link-button library-edit-button" type="button" onClick={() => setEditing(round)}>编辑</button> : null}
              {round.canManage ? <button className="link-button danger library-delete-button" type="button" onClick={() => { setMessage(""); setDeleting(round); }}>删除</button> : null}
            </div>
          </article>
        ))}
        {rounds.length === 0 ? <div className="library-list-empty"><span className="library-empty-mark" aria-hidden="true">01</span><div><strong>还没有比赛素材</strong><p>从一场值得复盘的比赛录像开始建立工作区档案。</p></div>{canCreate ? <button className="button" type="button" onClick={() => setCreating(true)}>创建第一份素材 <span aria-hidden="true">↗</span></button> : null}</div> : null}
      </div>

      {creating ? <LibraryRoundCreateModal onClose={() => !pending && setCreating(false)} /> : null}
      {editing ? <LibraryModal title="编辑比赛素材" onClose={() => !pending && setEditing(null)}><LibraryRoundForm round={editing} onCancel={() => setEditing(null)} onDone={(result: LibraryActionResult) => { if (result.ok) { setEditing(null); router.refresh(); } }} /></LibraryModal> : null}
      {deleting ? <LibraryModal title="删除比赛素材" onClose={() => !pending && setDeleting(null)}><p>确定删除这份素材吗？它会从工作区列表中隐藏。</p><p><strong data-language-raw>{deleting.title}</strong></p>{message ? <p className="status-error" role="alert">{message}</p> : null}<div className="document-modal-actions"><button className="button" type="button" onClick={() => setDeleting(null)} disabled={pending}>取消</button><button className="button danger" type="button" onClick={confirmDelete} disabled={pending}>{pending ? "删除中..." : "确认删除"}</button></div></LibraryModal> : null}
      {undoTarget ? <div className="document-delete-toast library-delete-toast" role="status" aria-live="polite"><div><strong>素材已删除</strong><span data-language-raw>{undoTarget.title}</span></div><button className="document-undo-button" type="button" disabled={pending} onClick={() => { const formData = new FormData(); formData.set("roundId", undoTarget.id); startTransition(async () => { const result = await restoreRound(formData); if (result.ok) { setUndoTarget(null); router.refresh(); } else setMessage(result.message); }); }}>{pending ? "恢复中..." : "撤回"}</button><span className="document-delete-toast-timer" aria-label={`还剩 ${seconds} 秒`}>{seconds}s</span></div> : null}
    </section>
  );
}
