"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { validateEvidence, type Evidence, type Side } from "@debate/shared";
import { addEvidenceToMatch, removeEvidenceFromMatch } from "@/app/app/documents/evidence-actions";
import { UndoToast } from "@/components/undo-toast";

interface EvidenceLibraryPanelProps {
  evidence: Evidence[];
  /** 传入则显示「加入比赛 / 移出」按钮。 */
  matchId?: string;
  /** 已关联到该比赛的 evidence id。 */
  linkedIds?: string[];
}

const SIDE_FILTERS: Array<Side | "All"> = ["All", "Aff", "Neg", "Pro", "Con", "Generic"];

export function EvidenceLibraryPanel({ evidence, matchId, linkedIds = [] }: EvidenceLibraryPanelProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sideFilter, setSideFilter] = useState<Side | "All">("All");
  const [issuesOnly, setIssuesOnly] = useState(false);
  // 本地乐观维护已关联集合，避免每次操作等一次整页刷新。
  const [linked, setLinked] = useState<Set<string>>(new Set(linkedIds));
  const [undo, setUndo] = useState<{ message: string; onUndo: () => void } | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return evidence.filter((card) => {
      if (sideFilter !== "All" && card.side !== sideFilter) return false;
      if (issuesOnly && validateEvidence(card).length === 0) return false;
      if (!needle) return true;
      const haystack = [card.title, card.claim, card.quote, card.author ?? "", card.publication ?? "", card.tags.join(" ")]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [evidence, query, sideFilter, issuesOnly]);

  async function link(card: Evidence) {
    if (!matchId) return;
    setLinked((current) => new Set(current).add(card.id));
    await addEvidenceToMatch({ evidenceId: card.id, matchId });
    setUndo({
      message: `已加入「${card.title}」`,
      onUndo: async () => {
        setLinked((current) => {
          const next = new Set(current);
          next.delete(card.id);
          return next;
        });
        await removeEvidenceFromMatch({ evidenceId: card.id, matchId });
        router.refresh();
      }
    });
    router.refresh();
  }

  async function unlink(card: Evidence) {
    if (!matchId) return;
    setLinked((current) => {
      const next = new Set(current);
      next.delete(card.id);
      return next;
    });
    await removeEvidenceFromMatch({ evidenceId: card.id, matchId });
    router.refresh();
  }

  return (
    <div className="library-panel">
      <div className="search-bar">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索 title / claim / quote / author / tag…"
          aria-label="搜索 evidence"
        />
        <label className="check-inline">
          <input type="checkbox" checked={issuesOnly} onChange={(event) => setIssuesOnly(event.target.checked)} />
          <span>只看有问题</span>
        </label>
      </div>
      <div className="filter-chips">
        {SIDE_FILTERS.map((side) => (
          <button
            key={side}
            type="button"
            className={`chip ${sideFilter === side ? "active" : ""}`}
            onClick={() => setSideFilter(side)}
          >
            {side}
          </button>
        ))}
        <span className="pill result-count">{filtered.length} / {evidence.length}</span>
      </div>

      <div className="library-list">
        {filtered.map((card) => {
          const issues = validateEvidence(card);
          const isLinked = linked.has(card.id);
          return (
            <article className="library-item" key={card.id}>
              <div className="library-item-main">
                <div className="evidence-meta">
                  <span className={`pill side-pill side-${card.side.toLowerCase()}`}>{card.side}</span>
                  {card.tags.slice(0, 4).map((tag) => (<span key={tag} className="pill">#{tag}</span>))}
                  {issues.map((issue) => (
                    <span key={issue.code} className={`issue-badge ${issue.level}`} title={issue.message}>{issue.code}</span>
                  ))}
                </div>
                <strong>{card.title}</strong>
                <p className="library-claim">{card.claim}</p>
                <p className="library-source">{card.publication ?? card.author ?? "Unlisted"} · {card.publishedDate ?? "No date"}</p>
              </div>
              {matchId ? (
                <div className="library-item-action">
                  {isLinked ? (
                    <button type="button" className="button" onClick={() => unlink(card)}>移出比赛</button>
                  ) : (
                    <button type="button" className="button primary" onClick={() => link(card)}>加入比赛</button>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
        {filtered.length === 0 ? <p className="empty-state">没有匹配的 evidence。</p> : null}
      </div>

      {undo ? (
        <UndoToast message={undo.message} onUndo={undo.onUndo} onDismiss={() => setUndo(null)} />
      ) : null}
    </div>
  );
}
