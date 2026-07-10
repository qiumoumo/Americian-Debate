"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EVIDENCE_SIDES,
  parseEvidenceCards,
  validateEvidence,
  type EvidenceDraft,
  type EvidenceIssue,
  type Side
} from "@debate/shared";
import { deleteEvidenceCards, importEvidenceCards } from "@/app/app/documents/evidence-actions";
import { UndoToast } from "@/components/undo-toast";

interface DocumentOption {
  id: string;
  title: string;
}

interface EvidenceImporterProps {
  documents: DocumentOption[];
}

interface DraftRow extends EvidenceDraft {
  key: string;
  selected: boolean;
}

const SAMPLE = `Title: Immigration expands labor supply
Claim: High-skill immigration raises productivity by complementing native workers.
Quote: Immigrant labor often complements rather than substitutes native labor, expanding output.
Source: https://example.org/labor-supply
Author: National Academies
Date: 2025
Side: Aff
Tags: economy, labor
---
Warming causes extinction #climate
Smith, Nature, 2023, https://example.org/warming
The scientific consensus indicates severe risks to ecosystems worldwide.`;

function toRows(drafts: EvidenceDraft[]): DraftRow[] {
  return drafts.map((draft, index) => ({ ...draft, key: `draft-${index}`, selected: true }));
}

function IssueBadges({ issues }: { issues: EvidenceIssue[] }) {
  if (!issues.length) {
    return <span className="issue-badge ok">✓ 完整</span>;
  }
  return (
    <>
      {issues.map((issue) => (
        <span key={issue.code} className={`issue-badge ${issue.level}`} title={issue.message}>
          {issue.message}
        </span>
      ))}
    </>
  );
}

export function EvidenceImporter({ documents }: EvidenceImporterProps) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  // 选择历史栈：记录每次选择变化前的快照，支持「撤回选择」。
  const [selectionHistory, setSelectionHistory] = useState<boolean[][]>([]);
  const [targetDocId, setTargetDocId] = useState(documents[0]?.id ?? "");
  const [isImporting, setIsImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ ids: string[]; message: string } | null>(null);

  const selectedCount = rows.filter((row) => row.selected).length;

  const issuesByKey = useMemo(() => {
    const map = new Map<string, EvidenceIssue[]>();
    for (const row of rows) {
      map.set(row.key, validateEvidence(row));
    }
    return map;
  }, [rows]);

  function pushSelectionSnapshot() {
    setSelectionHistory((history) => [...history, rows.map((row) => row.selected)]);
  }

  function parse() {
    const drafts = parseEvidenceCards(raw);
    setRows(toRows(drafts));
    setSelectionHistory([]);
    setStatus(drafts.length ? `解析出 ${drafts.length} 张卡片，检查后导入。` : "没有解析到卡片，试试用 --- 分隔或 Title:/Quote: 标签。");
  }

  function toggleRow(key: string) {
    pushSelectionSnapshot();
    setRows((current) => current.map((row) => (row.key === key ? { ...row, selected: !row.selected } : row)));
  }

  function setAllSelected(value: boolean) {
    pushSelectionSnapshot();
    setRows((current) => current.map((row) => ({ ...row, selected: value })));
  }

  function undoSelection() {
    setSelectionHistory((history) => {
      if (!history.length) return history;
      const previous = history[history.length - 1];
      setRows((current) => current.map((row, index) => ({ ...row, selected: previous[index] ?? row.selected })));
      return history.slice(0, -1);
    });
  }

  function editField(key: string, patch: Partial<EvidenceDraft>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  async function runImport() {
    const selected = rows.filter((row) => row.selected);
    if (!targetDocId || !selected.length) return;
    setIsImporting(true);
    setStatus(null);
    try {
      const cards: EvidenceDraft[] = selected.map((row) => ({
        title: row.title,
        claim: row.claim,
        quote: row.quote,
        sourceUrl: row.sourceUrl,
        author: row.author,
        publication: row.publication,
        publishedDate: row.publishedDate,
        side: row.side,
        tags: row.tags
      }));
      const result = await importEvidenceCards({ documentId: targetDocId, cards });
      // 导入成功的卡片从预览中移除，剩余留待继续处理。
      const importedKeys = new Set(selected.map((row) => row.key));
      setRows((current) => current.filter((row) => !importedKeys.has(row.key)));
      setSelectionHistory([]);
      setUndo({ ids: result.ids, message: `已导入 ${result.created} 张 evidence` });
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败。");
    } finally {
      setIsImporting(false);
    }
  }

  async function performUndo(ids: string[]) {
    await deleteEvidenceCards({ ids });
    router.refresh();
    setStatus("已撤回本次导入。");
  }

  if (!documents.length) {
    return <p className="empty-state">请先创建文档，再导入 evidence。</p>;
  }

  return (
    <div className="evidence-importer">
      <label className="field">
        <span>粘贴外部 evidence 文本</span>
        <textarea
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          rows={7}
          placeholder="支持 Title:/Claim:/Quote:/Source:/Author:/Date:/Tags: 标签式，或首行标题 + 出处行 + 引用的辩论卡式。多张卡片用 --- 或空行分隔。"
        />
      </label>
      <div className="actions">
        <button type="button" className="button primary" onClick={parse} disabled={!raw.trim()}>解析预览</button>
        <button type="button" className="button" onClick={() => { setRaw(SAMPLE); setStatus("已填入示例，点「解析预览」。"); }}>填入示例</button>
        {raw ? <button type="button" className="link-button" onClick={() => { setRaw(""); setRows([]); }}>清空</button> : null}
      </div>

      {status ? <p className="small-note">{status}</p> : null}

      {rows.length ? (
        <>
          <div className="evidence-toolbar">
            <span className="pill">{selectedCount}/{rows.length} 选中</span>
            <button type="button" className="link-button" onClick={() => setAllSelected(true)}>全选</button>
            <button type="button" className="link-button" onClick={() => setAllSelected(false)}>全不选</button>
            <button type="button" className="link-button" onClick={undoSelection} disabled={!selectionHistory.length}>撤回选择</button>
            <label className="field inline-field">
              <span>导入到</span>
              <select value={targetDocId} onChange={(event) => setTargetDocId(event.target.value)}>
                {documents.map((doc) => (<option key={doc.id} value={doc.id}>{doc.title}</option>))}
              </select>
            </label>
            <button type="button" className="button primary" onClick={runImport} disabled={isImporting || !selectedCount}>
              {isImporting ? "导入中..." : `导入选中 (${selectedCount})`}
            </button>
          </div>

          <div className="import-list">
            {rows.map((row) => {
              const issues = issuesByKey.get(row.key) ?? [];
              return (
                <article className={`import-card ${row.selected ? "" : "deselected"}`} key={row.key}>
                  <div className="import-card-head">
                    <label className="check-inline">
                      <input type="checkbox" checked={row.selected} onChange={() => toggleRow(row.key)} />
                      <input
                        className="import-title"
                        value={row.title}
                        onChange={(event) => editField(row.key, { title: event.target.value })}
                        placeholder="标题"
                      />
                    </label>
                    <button type="button" className="link-button danger" onClick={() => removeRow(row.key)}>移除</button>
                  </div>
                  <div className="import-badges"><IssueBadges issues={issues} /></div>
                  <textarea
                    value={row.claim}
                    onChange={(event) => editField(row.key, { claim: event.target.value })}
                    rows={2}
                    placeholder="Claim"
                  />
                  <textarea
                    value={row.quote}
                    onChange={(event) => editField(row.key, { quote: event.target.value })}
                    rows={3}
                    placeholder="Quote"
                  />
                  <div className="import-grid">
                    <input value={row.sourceUrl} onChange={(event) => editField(row.key, { sourceUrl: event.target.value })} placeholder="Source URL" />
                    <input value={row.publishedDate ?? ""} onChange={(event) => editField(row.key, { publishedDate: event.target.value })} placeholder="Date" />
                    <input value={row.author ?? ""} onChange={(event) => editField(row.key, { author: event.target.value })} placeholder="Author" />
                    <input value={row.publication ?? ""} onChange={(event) => editField(row.key, { publication: event.target.value })} placeholder="Publication" />
                    <select value={row.side} onChange={(event) => editField(row.key, { side: event.target.value as Side })}>
                      {EVIDENCE_SIDES.map((side) => (<option key={side} value={side}>{side}</option>))}
                    </select>
                    <input
                      value={row.tags.join(", ")}
                      onChange={(event) => editField(row.key, { tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })}
                      placeholder="Tags（逗号分隔）"
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : null}

      {undo ? (
        <UndoToast
          message={undo.message}
          onUndo={() => performUndo(undo.ids)}
          onDismiss={() => setUndo(null)}
        />
      ) : null}
    </div>
  );
}
