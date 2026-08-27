"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { createDocument, deleteDocument, restoreDocument, type DocumentActionResult } from "@/app/app/documents/actions";
import { ReliableLink } from "@/components/reliable-link";

interface DocumentListItem {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  evidenceCount: number;
  visibility: "GLOBAL" | "PERSONAL";
  canDelete: boolean;
}

interface DocumentListWorkspaceProps {
  documents: DocumentListItem[];
  canCreate: boolean;
}

const emptyResult: DocumentActionResult = { ok: false, message: "" };

function ModalFrame({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div className="document-modal-backdrop" onMouseDown={closeFromBackdrop}>
      <section className="document-modal" role="dialog" aria-modal="true" aria-labelledby="document-modal-title">
        <header className="document-modal-head">
          <h2 id="document-modal-title">{title}</h2>
          <button className="link-button" type="button" onClick={onClose} aria-label="关闭">关闭</button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function DocumentListWorkspace({ documents, canCreate }: DocumentListWorkspaceProps) {
  const router = useRouter();
  const titleInput = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState(emptyResult);
  const [createPending, startCreate] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<DocumentListItem | null>(null);
  const [deleteResult, setDeleteResult] = useState(emptyResult);
  const [deletePending, startDelete] = useTransition();
  const [undoTarget, setUndoTarget] = useState<DocumentListItem | null>(null);
  const [undoSeconds, setUndoSeconds] = useState(5);
  const [undoPending, startUndo] = useTransition();

  useEffect(() => {
    if (!undoTarget) return;
    const expiresAt = Date.now() + 5000;
    setUndoSeconds(5);
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setUndoSeconds(seconds);
      if (seconds === 0) {
        window.clearInterval(timer);
        setUndoTarget(null);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [undoTarget]);

  useEffect(() => {
    if (creating) titleInput.current?.focus();
  }, [creating]);

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startCreate(async () => {
      const result = await createDocument(formData);
      setCreateResult(result);
      if (result.ok && result.documentId) router.push(`/app/documents/${encodeURIComponent(result.documentId)}`);
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const formData = new FormData();
    formData.set("documentId", deleteTarget.id);
    startDelete(async () => {
      const result = await deleteDocument(formData);
      setDeleteResult(result);
      if (result.ok) {
        setUndoTarget(deleteTarget);
        setDeleteTarget(null);
        router.refresh();
      }
    });
  }

  return (
    <section className="document-index" aria-labelledby="document-index-title">
      <header className="document-index-head">
        <div className="document-index-title-block">
          <div className="document-index-kicker"><span className="document-index-kicker-dot" aria-hidden="true" />WORKSPACE / DOCUMENTS</div>
          <h1 id="document-index-title">共享文档</h1>
          <p>把辩题、论证与证据整理成一份可共同推进的工作底稿。</p>
        </div>
        <div className="document-index-head-action">
          <span className="document-index-count"><strong>{String(documents.length).padStart(2, "0")}</strong><span>份文档</span></span>
          {canCreate ? <button className="button primary document-create-button" type="button" onClick={() => { setCreateResult(emptyResult); setCreating(true); }}><span aria-hidden="true">+</span>新建文档</button> : <span className="pill">只读</span>}
        </div>
      </header>

      <div className="document-list-head" aria-hidden="true"><span>DOCUMENTS / {String(documents.length).padStart(2, "0")}</span><span>最近更新</span></div>
      <div className="document-list" aria-label="文档列表">
        {documents.map((document, index) => (
          <article className="document-list-row" key={document.id}>
            <span className="document-row-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <div className="document-list-copy">
              <strong data-language-raw>{document.title}</strong>
              <span className={`document-visibility-badge document-visibility-${document.visibility.toLowerCase()}`}>{document.visibility === "PERSONAL" ? "个人" : "全局"}</span>
              {document.description ? <p data-language-raw>{document.description}</p> : <p className="empty-state">暂无描述</p>}
            </div>
            <div className="document-list-meta"><span className="document-updated-at">{document.updatedAt}</span><span className="document-evidence-count"><span className="document-evidence-dot" aria-hidden="true" /><span data-language-raw>{document.evidenceCount}</span> 条证据</span></div>
            <div className="document-list-actions">
              <ReliableLink className="button primary document-open-button" href={`/app/documents/${document.id}`}>打开编辑 <span aria-hidden="true">↗</span></ReliableLink>
              {document.canDelete ? <button className="link-button danger document-delete-button" type="button" onClick={() => { setDeleteResult(emptyResult); setDeleteTarget(document); }}><span aria-hidden="true">×</span>删除文档</button> : null}
            </div>
          </article>
        ))}
        {documents.length === 0 ? <div className="document-list-empty"><span className="document-empty-mark" aria-hidden="true">01</span><div><strong>还没有文档</strong><p>从一份新的辩题工作底稿开始。</p></div>{canCreate ? <button className="button" type="button" onClick={() => { setCreateResult(emptyResult); setCreating(true); }}>创建第一份文档 <span aria-hidden="true">↗</span></button> : null}</div> : null}
      </div>

      {creating ? (
        <ModalFrame title="新建文档" onClose={() => !createPending && setCreating(false)}>
          <form className="form-grid" onSubmit={submitCreate}>
            <label className="field">
              <span>文档标题</span>
              <input ref={titleInput} name="title" required aria-invalid={Boolean(createResult.fieldErrors?.title)} />
              {createResult.fieldErrors?.title ? <small className="error-text">{createResult.fieldErrors.title}</small> : null}
            </label>
            <label className="field"><span>描述</span><textarea name="description" rows={3} placeholder="这份资料主要覆盖哪些论点？" /></label>
            <label className="field"><span>可见范围</span><select name="visibility" defaultValue="GLOBAL"><option value="GLOBAL">全局（当前工作区成员可见）</option><option value="PERSONAL">个人（仅自己可见）</option></select></label>
            {createResult.message && !createResult.ok ? <p className="status-error" role="alert">{createResult.message}</p> : null}
            <div className="document-modal-actions">
              <button className="button" type="button" onClick={() => setCreating(false)} disabled={createPending}>取消</button>
              <button className="button primary" type="submit" disabled={createPending}>{createPending ? "创建中..." : "保存并进入编辑"}</button>
            </div>
          </form>
        </ModalFrame>
      ) : null}

      {deleteTarget ? (
        <ModalFrame title="删除文档" onClose={() => !deletePending && setDeleteTarget(null)}>
          <p>确定删除这份文档吗？文档会从共享列表和证据检索中隐藏。</p>
          <p><strong data-language-raw>{deleteTarget.title}</strong></p>
          {deleteResult.message && !deleteResult.ok ? <p className="status-error" role="alert">{deleteResult.message}</p> : null}
          <div className="document-modal-actions">
            <button className="button" type="button" onClick={() => setDeleteTarget(null)} disabled={deletePending}>取消</button>
            <button className="button danger" type="button" onClick={confirmDelete} disabled={deletePending}>{deletePending ? "删除中..." : "确认删除"}</button>
          </div>
        </ModalFrame>
      ) : null}

      {undoTarget ? (
        <div className="document-delete-toast" role="status" aria-live="polite">
          <div><strong>文档已删除</strong><span data-language-raw>{undoTarget.title}</span></div>
          <button className="document-undo-button" type="button" disabled={undoPending} onClick={() => {
            const formData = new FormData();
            formData.set("documentId", undoTarget.id);
            startUndo(async () => {
              const result = await restoreDocument(formData);
              if (result.ok) setUndoTarget(null);
              else setDeleteResult(result);
            });
          }}>{undoPending ? "恢复中..." : "撤回"}</button>
          <span className="document-delete-toast-timer" aria-label={`还剩 ${undoSeconds} 秒`}>{undoSeconds}s</span>
        </div>
      ) : null}
    </section>
  );
}
