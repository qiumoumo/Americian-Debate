"use client";

import { useEffect, useMemo, useState } from "react";
import type { Evidence, Side } from "@debate/shared";
import { insertAIDraft } from "@/app/app/matches/actions";

interface AIDraftPanelProps {
  matchId?: string;
  side: Side;
  evidence: Evidence[];
}

interface DraftResponse {
  provider: string;
  model?: string;
  draft: {
    ourCase: Array<{ speech: string; argument: string; evidenceIds: string[]; suggestedText: string }>;
    frontlines: Array<{ opponentArgument: string; response: string; evidenceIds: string[] }>;
    risks: string[];
  };
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as { error?: string };
  } catch {
    return { error: response.ok ? undefined : text.slice(0, 240) };
  }
}

export function AIDraftPanel({ matchId, side, evidence }: AIDraftPanelProps) {
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>(evidence.slice(0, 2).map((card) => card.id));
  const [opponentContext, setOpponentContext] = useState("Opponent likely presses fiscal costs and framework weighing.");
  const [consent, setConsent] = useState(false);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const evidenceKey = useMemo(() => evidence.map((card) => card.id).join("|"), [evidence]);

  useEffect(() => {
    const availableIds = new Set(evidence.map((card) => card.id));
    setSelectedEvidenceIds((current) => {
      const filtered = current.filter((id) => availableIds.has(id));
      return filtered.length ? filtered : evidence.slice(0, 2).map((card) => card.id);
    });
    setDraft(null);
  }, [evidence, evidenceKey, matchId]);

  const selectedEvidence = useMemo(
    () => evidence.filter((card) => selectedEvidenceIds.includes(card.id)),
    [evidence, selectedEvidenceIds]
  );

  function toggleEvidence(evidenceId: string) {
    setSelectedEvidenceIds((current) => (
      current.includes(evidenceId) ? current.filter((id) => id !== evidenceId) : [...current, evidenceId]
    ));
  }

  async function generateDraft() {
    setError(null);
    setDraft(null);
    setIsGenerating(true);

    try {
      const response = await fetch("/api/ai/generate-match-notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchId,
          side,
          evidenceIds: selectedEvidenceIds,
          opponentContext,
          consentToSendEvidence: consent
        })
      });

      const payload = await readJsonResponse(response);
      if (!response.ok) {
        setError(payload.error ?? "AI draft failed");
        return;
      }

      setDraft(payload as DraftResponse);
    } catch {
      setError("AI draft failed. Please check your network or server logs.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyPrompt() {
    setError(null);
    setCopyStatus(null);

    try {
      const response = await fetch("/api/ai/generate-match-notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchId,
          side,
          evidenceIds: selectedEvidenceIds,
          opponentContext,
          copyPromptOnly: true
        })
      });
      const payload = await readJsonResponse(response) as { error?: string; prompt?: string };
      if (!response.ok || !payload.prompt) {
        setError(payload.error ?? "Could not build prompt");
        return;
      }
      await navigator.clipboard.writeText(payload.prompt);
      setCopyStatus("Prompt copied. Paste it into DeepSeek, ChatGPT, Claude, or another model.");
    } catch {
      setError("Could not copy prompt. Please check browser clipboard permissions.");
    }
  }

  const draftText = draft ? JSON.stringify(draft.draft, null, 2) : "";

  return (
    <div className="stack">
      <div className="evidence-picker">
        {evidence.map((card) => (
          <label className="check-card" key={card.id}>
            <input
              type="checkbox"
              checked={selectedEvidenceIds.includes(card.id)}
              onChange={() => toggleEvidence(card.id)}
            />
            <span>
              <strong>{card.title}</strong>
              <small>{card.side} · {card.tags.join(", ")}</small>
            </span>
          </label>
        ))}
      </div>
      <label className="field">
        <span>Opponent context</span>
        <textarea value={opponentContext} onChange={(event) => setOpponentContext(event.target.value)} rows={4} />
      </label>
      <label className="consent-row">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>我同意把选中的 {selectedEvidence.length} 条 evidence 和上下文发送给服务器端 AI provider。API key 不会进入浏览器。</span>
      </label>
      <div className="actions">
        <button
          className="button primary"
          type="button"
          disabled={!consent || selectedEvidenceIds.length === 0 || isGenerating}
          onClick={generateDraft}
        >
          {isGenerating ? "Generating..." : "Generate AI draft"}
        </button>
        <button
          className="button"
          type="button"
          disabled={selectedEvidenceIds.length === 0 || isGenerating}
          onClick={copyPrompt}
        >
          Copy prompt
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {copyStatus ? <p className="success-text">{copyStatus}</p> : null}
      {draft ? (
        <div className="draft-box">
          <div className="evidence-meta">
            <span className="pill">{draft.provider}</span>
            {draft.model ? <span className="pill">{draft.model}</span> : null}
            <span className="pill">草稿，需确认后插入</span>
          </div>
          <pre>{draftText}</pre>
          {matchId ? (
            <form action={insertAIDraft} className="stack">
              <input type="hidden" name="matchId" value={matchId} />
              <input type="hidden" name="draftText" value={draftText} />
              <p className="small-note">AI 草稿不会自动写入正式笔记；点击下方按钮才会保存到比赛记录。</p>
              <button className="button" type="submit">确认并保存草稿</button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
