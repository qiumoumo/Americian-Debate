"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { createDocument, deleteDocument, type DocumentActionResult } from "@/app/app/documents/actions";
import { ReliableLink } from "@/components/reliable-link";

interface DocumentListItem {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  evidenceCount: number;
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
        setDeleteTarget(null);
        router.refresh();
      }
    });
  }

  return (
    <section className="document-index" aria-labelledby="document-index-title">
      <header className="document-index-head">
        <div><div className="eyebrow">Shared Documents</div><h1 id="document-index-title">共享文档</h1></div>
        {canCreate ? <button className="button primary" type="button" onClick={() => { setCreateResult(emptyResult); setCreating(true); }}>新建文档</button> : <span className="pill">只读</span>}
      </header>

      {deleteResult.ok && deleteResult.message ? (
        <p className="success-text" role="status" aria-live="polite">{deleteResult.message}</p>
      ) : null}

      <div className="document-list" aria-label="文档列表">
        {documents.map((document) => (
          <article className="document-list-row" key={document.id}>
            <div className="document-list-copy">
              <strong data-language-raw>{document.title}</strong>
              {document.description ? <p data-language-raw>{document.description}</p> : <p className="empty-state">暂无描述</p>}
            </div>
            <div className="document-list-meta"><span>{document.updatedAt}</span><span><span data-language-raw>{document.evidenceCount}</span> <span>条证据</span></span></div>
            <div className="document-list-actions">
              <ReliableLink className="button primary" href={`/app/documents/${document.id}`}>打开编辑 →</ReliableLink>
              {document.canDelete ? <button className="link-button danger" type="button" onClick={() => { setDeleteResult(emptyResult); setDeleteTarget(document); }}>删除文档</button> : null}
            </div>
          </article>
        ))}
        {documents.length === 0 ? <p className="empty-state document-list-empty">还没有文档。</p> : null}
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
    </section>
  );
}
