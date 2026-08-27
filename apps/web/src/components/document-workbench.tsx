"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { EVIDENCE_SIDES, type Evidence, type Side } from "@debate/shared";
import { saveDocument, type DocumentActionResult } from "@/app/app/documents/actions";
import {
  createEvidenceCard,
  deleteEvidenceCards,
  updateEvidenceCard
} from "@/app/app/documents/evidence-actions";
import { EvidenceImporter } from "@/components/evidence-importer";
import { ReliableLink } from "@/components/reliable-link";

interface EditableDocument {
  id: string;
  title: string;
  description: string;
  visibility: "GLOBAL" | "PERSONAL";
  contentText?: string;
  updatedAt: string;
  evidence: Evidence[];
}

interface DocumentWorkbenchProps {
  document: EditableDocument;
  canEdit: boolean;
}

type EvidenceMode = "edit" | "new" | "import";
const emptyResult: DocumentActionResult = { ok: false, message: "" };

function evidenceInput(formData: FormData, documentId: string) {
  return {
    documentId,
    title: String(formData.get("title") ?? ""),
    claim: String(formData.get("claim") ?? ""),
    quote: String(formData.get("quote") ?? ""),
    sourceUrl: String(formData.get("sourceUrl") ?? ""),
    author: String(formData.get("author") ?? ""),
    publication: String(formData.get("publication") ?? ""),
    publishedDate: String(formData.get("publishedDate") ?? ""),
    side: String(formData.get("side") ?? "Generic") as Side,
    tags: String(formData.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean)
  };
}

function EvidenceFields({ card }: { card?: Evidence }) {
  return (
    <div className="form-grid compact">
      <label className="field"><span>标题</span><input name="title" defaultValue={card?.title ?? ""} required /></label>
      <label className="field"><span>Claim</span><textarea name="claim" defaultValue={card?.claim ?? ""} rows={2} required /></label>
      <label className="field"><span>Quote</span><textarea name="quote" defaultValue={card?.quote ?? ""} rows={4} required /></label>
      <div className="form-grid two-columns">
        <label className="field"><span>立场</span><select name="side" defaultValue={card?.side ?? "Generic"}>{EVIDENCE_SIDES.map((side) => <option key={side}>{side}</option>)}</select></label>
        <label className="field"><span>标签</span><input name="tags" defaultValue={card?.tags.join(", ") ?? ""} placeholder="economy, weighing" /></label>
      </div>
      <label className="field"><span>来源链接</span><input name="sourceUrl" type="url" defaultValue={card?.sourceUrl ?? ""} placeholder="https://..." /></label>
      <div className="form-grid two-columns">
        <label className="field"><span>作者 / 机构</span><input name="author" defaultValue={card?.author ?? ""} /></label>
        <label className="field"><span>刊物 / 报告</span><input name="publication" defaultValue={card?.publication ?? ""} /></label>
      </div>
      <label className="field"><span>发布日期</span><input name="publishedDate" defaultValue={card?.publishedDate ?? ""} placeholder="2026" /></label>
    </div>
  );
}

function EvidenceWorkspace({ documentId, evidence, canEdit }: { documentId: string; evidence: Evidence[]; canEdit: boolean }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(evidence[0]?.id ?? "");
  const [mode, setMode] = useState<EvidenceMode>("edit");
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  const selected = useMemo(() => evidence.find((card) => card.id === selectedId) ?? evidence[0], [evidence, selectedId]);

  useEffect(() => {
    if (selectedId && !evidence.some((card) => card.id === selectedId)) setSelectedId(evidence[0]?.id ?? "");
  }, [evidence, selectedId]);

  function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = evidenceInput(new FormData(event.currentTarget), documentId);
    setStatus("");
    startTransition(async () => {
      try {
        if (mode === "new") {
          const result = await createEvidenceCard(input);
          setStatus(result.message);
          if (!result.ok) return;
          if (result.id) setSelectedId(result.id);
          setMode("edit");
        } else if (selected) {
          await updateEvidenceCard({ id: selected.id, ...input });
          setStatus("证据改动已保存。");
        }
        router.refresh();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "证据保存失败。");
      }
    });
  }

  function removeSelected() {
    if (!selected || !window.confirm("确定删除这条证据吗？已关联比赛中的引用也会被移除。")) return;
    startTransition(async () => {
      try {
        await deleteEvidenceCards({ ids: [selected.id] });
        setSelectedId("");
        setStatus("证据已删除。");
        router.refresh();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "证据删除失败。");
      }
    });
  }

  return (
    <aside className="document-evidence-workspace" aria-labelledby="document-evidence-title">
      <header className="document-panel-head">
        <div><span className="document-panel-kicker">Evidence</span><h2 id="document-evidence-title">证据工作区</h2></div>
        <span className="pill"><span data-language-raw>{evidence.length}</span>&nbsp;<span>条证据</span></span>
      </header>

      {canEdit ? (
        <div className="document-evidence-modes" aria-label="证据操作">
          <button className={`chip ${mode === "edit" ? "active" : ""}`} type="button" onClick={() => setMode("edit")}>选中编辑</button>
          <button className={`chip ${mode === "new" ? "active" : ""}`} type="button" onClick={() => setMode("new")}>新增证据</button>
          <button className={`chip ${mode === "import" ? "active" : ""}`} type="button" onClick={() => setMode("import")}>批量导入</button>
        </div>
      ) : <p className="small-note">当前为只读访问。</p>}

      {mode === "import" && canEdit ? (
        <div className="document-evidence-editor"><EvidenceImporter documentId={documentId} /></div>
      ) : mode === "new" && canEdit ? (
        <form className="document-evidence-editor" onSubmit={submitEvidence}>
          <h3>新增证据</h3>
          <EvidenceFields />
          {status ? <p className="small-note" role="status">{status}</p> : null}
          <button className="button primary" type="submit" disabled={pending}>{pending ? "保存中..." : "添加证据"}</button>
        </form>
      ) : selected ? (
        <form className="document-evidence-editor" key={selected.id} onSubmit={submitEvidence}>
          <h3 data-language-raw>{selected.title}</h3>
          <fieldset disabled={!canEdit || pending}><EvidenceFields card={selected} /></fieldset>
          {status ? <p className="small-note" role="status">{status}</p> : null}
          {canEdit ? <div className="actions"><button className="button primary" type="submit" disabled={pending}>{pending ? "保存中..." : "保存证据"}</button><button className="link-button danger" type="button" onClick={removeSelected} disabled={pending}>删除证据</button></div> : null}
        </form>
      ) : (
        <div className="document-evidence-editor"><p className="empty-state">这份文档还没有证据。</p></div>
      )}

      <div className="document-evidence-list" aria-label="文档证据列表">
        {evidence.map((card) => (
          <button className="document-evidence-row" data-active={selected?.id === card.id && mode === "edit"} type="button" key={card.id} onClick={() => { setSelectedId(card.id); setMode("edit"); setStatus(""); }}>
            <span className={`pill side-pill side-${card.side.toLowerCase()}`}>{card.side}</span>
            <strong data-language-raw>{card.title}</strong>
            <small data-language-raw>{card.claim}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

export function DocumentWorkbench({ document, canEdit }: DocumentWorkbenchProps) {
  const router = useRouter();
  const [title, setTitle] = useState(document.title);
  const [description, setDescription] = useState(document.description);
  const [visibility, setVisibility] = useState(document.visibility);
  const [content, setContent] = useState(document.contentText ?? "");
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState(emptyResult);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function markChanged(update: () => void) {
    update();
    setDirty(true);
    setResult(emptyResult);
  }

  function submitDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const next = await saveDocument(formData);
      setResult(next);
      if (next.ok) {
        setDirty(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="document-workbench">
      <header className="document-workbench-bar">
        <ReliableLink className="button ghost" href="/app/documents">返回文档列表</ReliableLink>
        <div className="document-save-state" aria-live="polite">
          {!canEdit ? <span className="pill">只读</span> : dirty ? <span className="pill warning">有未保存改动</span> : <span className="pill">已保存</span>}
        </div>
      </header>

      <div className="document-workbench-grid">
        <form className="document-body-workspace" onSubmit={submitDocument}>
          <header className="document-panel-head">
            <div><span className="document-panel-kicker">Document</span><h2>文档内容</h2></div>
            {canEdit ? <button className="button primary" type="submit" disabled={pending || !dirty}>{pending ? "保存中..." : "保存文档"}</button> : null}
          </header>
          <input type="hidden" name="documentId" value={document.id} />
          <fieldset disabled={!canEdit || pending}>
          <div className="document-meta-fields">
              <label className="field"><span>标题</span><input name="title" value={title} required onChange={(event) => markChanged(() => setTitle(event.target.value))} /></label>
              <label className="field"><span>描述</span><textarea name="description" value={description} rows={2} onChange={(event) => markChanged(() => setDescription(event.target.value))} /></label>
              <label className="field"><span>可见范围</span><select name="visibility" value={visibility} onChange={(event) => markChanged(() => setVisibility(event.target.value as "GLOBAL" | "PERSONAL"))}><option value="GLOBAL">全局（当前工作区成员可见）</option><option value="PERSONAL">个人（仅自己可见）</option></select></label>
            </div>
            <label className="field document-body-field">
              <span>正文</span>
              <textarea name="content" value={content} onChange={(event) => markChanged(() => setContent(event.target.value))} placeholder="粘贴 case text、blocks 或研究笔记..." />
            </label>
          </fieldset>
          {result.message ? <p className={result.ok ? "success-text" : "status-error"} role="status">{result.message}</p> : null}
        </form>

        <EvidenceWorkspace documentId={document.id} evidence={document.evidence} canEdit={canEdit} />
      </div>
    </div>
  );
}
