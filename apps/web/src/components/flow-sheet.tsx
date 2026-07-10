"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  Evidence,
  FlowCell,
  FlowCellStatus,
  FlowColumn,
  FlowResponse,
  FlowResponseKind,
  FlowRow,
  FlowSuggestionCategory,
  FlowWeighing,
  Side
} from "@debate/shared";
import {
  addFlowResponse,
  deleteFlowResponse,
  deleteFlowRow,
  saveFlowCell,
  saveFlowResponse,
  saveFlowWeighing
} from "@/app/app/matches/flow-actions";

interface FlowSheetProps {
  matchId: string;
  columns: FlowColumn[];
  rows: FlowRow[];
  evidence: Evidence[];
}

interface FlowSuggestion {
  label: string;
  category: FlowSuggestionCategory;
  response: string;
  strategy: string;
  evidenceIds: string[];
}

const STATUS_OPTIONS: FlowCellStatus[] = ["open", "extended", "answered", "dropped", "turned", "conceded"];

// Argument Status 图例：颜色沿用 .flow-status-* 样式，含义用于「更直观」的判读。
const STATUS_LEGEND: Array<{ status: FlowCellStatus; label: string }> = [
  { status: "open", label: "未处理" },
  { status: "extended", label: "已延伸" },
  { status: "answered", label: "已回应" },
  { status: "dropped", label: "掉线 drop" },
  { status: "turned", label: "被打回" },
  { status: "conceded", label: "让步" }
];

// 需要在 row-head 高亮统计的「危险」状态。
const RISKY_STATUSES: FlowCellStatus[] = ["dropped", "conceded"];

const RESPONSE_KIND_OPTIONS: FlowResponseKind[] = ["response", "answer", "turn", "weigh", "collapse"];

const KIND_LABEL: Record<FlowResponseKind, string> = {
  response: "回应",
  answer: "Answer",
  turn: "Turn",
  weigh: "Weigh",
  collapse: "Collapse"
};

const CATEGORY_LABEL: Record<FlowSuggestionCategory, string> = {
  answer: "Answer · 直接回应",
  turn: "Turn · 打回",
  weigh: "Weigh · 权衡",
  collapse: "Collapse · 收束"
};

const CATEGORY_ORDER: FlowSuggestionCategory[] = ["answer", "turn", "weigh", "collapse"];

const WEIGHING_FIELDS: Array<{ key: keyof FlowWeighing; label: string; placeholder: string }> = [
  { key: "magnitude", label: "Magnitude", placeholder: "影响规模：多大、多少人" },
  { key: "probability", label: "Probability", placeholder: "发生概率 / 链条强度" },
  { key: "timeframe", label: "Timeframe", placeholder: "时间线：短期 / 长期" },
  { key: "scope", label: "Scope", placeholder: "范围：本地 / 全球 / 群体" }
];

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

export function FlowSheet({ matchId, columns, rows: initialRows, evidence }: FlowSheetProps) {
  const [rows, setRows] = useState<FlowRow[]>(initialRows);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [suggestions, setSuggestions] = useState<FlowSuggestion[]>([]);
  const [weighing, setWeighing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [, startTransition] = useTransition();

  const evidenceById = useMemo(() => new Map(evidence.map((card) => [card.id, card])), [evidence]);

  function persistCell(cell: FlowCell) {
    const formData = new FormData();
    formData.set("cellId", cell.id);
    formData.set("content", cell.content);
    formData.set("status", cell.status);
    formData.set("evidenceIds", JSON.stringify(cell.evidenceIds));
    startTransition(() => {
      void saveFlowCell(formData);
    });
  }

  function updateCell(cellId: string, patch: Partial<FlowCell>, persist: boolean) {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => {
          if (cell.id !== cellId) {
            return cell;
          }
          const next = { ...cell, ...patch };
          if (persist) {
            persistCell(next);
          }
          return next;
        })
      }))
    );
  }

  function rowSideForCell(cellId: string): Side {
    const owner = rows.find((row) => row.cells.some((cell) => cell.id === cellId));
    return owner?.side ?? "Generic";
  }

  // ── line-by-line 链操作 ──────────────────────────────────────────
  async function addResponse(cell: FlowCell, init: { kind: FlowResponseKind; content?: string; evidenceIds?: string[] }) {
    const formData = new FormData();
    formData.set("cellId", cell.id);
    formData.set("side", rowSideForCell(cell.id));
    formData.set("kind", init.kind);
    formData.set("content", init.content ?? "");
    formData.set("evidenceIds", JSON.stringify(init.evidenceIds ?? []));
    const created = await addFlowResponse(formData);
    setRows((current) =>
      current.map((row) => ({
        ...row,
        cells: row.cells.map((entry) =>
          entry.id === cell.id ? { ...entry, responses: [...entry.responses, created] } : entry
        )
      }))
    );
    return created;
  }

  function persistResponse(cellId: string, response: FlowResponse) {
    const formData = new FormData();
    formData.set("responseId", response.id);
    formData.set("content", response.content);
    formData.set("status", response.status);
    formData.set("kind", response.kind);
    formData.set("evidenceIds", JSON.stringify(response.evidenceIds));
    startTransition(() => {
      void saveFlowResponse(formData);
    });
    void cellId;
  }

  function updateResponse(cellId: string, responseId: string, patch: Partial<FlowResponse>, persist: boolean) {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => {
          if (cell.id !== cellId) {
            return cell;
          }
          return {
            ...cell,
            responses: cell.responses.map((response) => {
              if (response.id !== responseId) {
                return response;
              }
              const next = { ...response, ...patch };
              if (persist) {
                persistResponse(cellId, next);
              }
              return next;
            })
          };
        })
      }))
    );
  }

  function removeResponse(cellId: string, responseId: string) {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        cells: row.cells.map((cell) =>
          cell.id === cellId ? { ...cell, responses: cell.responses.filter((r) => r.id !== responseId) } : cell
        )
      }))
    );
    const formData = new FormData();
    formData.set("responseId", responseId);
    startTransition(() => {
      void deleteFlowResponse(formData);
    });
  }

  // ── weighing 操作 ───────────────────────────────────────────────
  function persistWeighing(rowId: string, weighingValue: FlowWeighing) {
    const formData = new FormData();
    formData.set("flowRowId", rowId);
    formData.set("magnitude", weighingValue.magnitude);
    formData.set("probability", weighingValue.probability);
    formData.set("timeframe", weighingValue.timeframe);
    formData.set("scope", weighingValue.scope);
    startTransition(() => {
      void saveFlowWeighing(formData);
    });
  }

  function updateWeighing(rowId: string, patch: Partial<FlowWeighing>, persist: boolean) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) {
          return row;
        }
        const next = { ...row, weighing: { ...row.weighing, ...patch } };
        if (persist) {
          persistWeighing(rowId, next.weighing);
        }
        return next;
      })
    );
  }

  // ── AI assistant ────────────────────────────────────────────────
  function findCell(cellId: string): FlowCell | undefined {
    for (const row of rows) {
      const cell = row.cells.find((entry) => entry.id === cellId);
      if (cell) {
        return cell;
      }
    }
    return undefined;
  }

  function openAssistant(cellId: string) {
    if (activeCellId === cellId) {
      setActiveCellId(null);
      return;
    }
    const cell = findCell(cellId);
    setActiveCellId(cellId);
    setSuggestions([]);
    setWeighing([]);
    setError(null);
    setCopyStatus(null);
    setSelectedEvidenceIds(cell?.evidenceIds ?? []);
  }

  function toggleEvidence(evidenceId: string) {
    setSelectedEvidenceIds((current) =>
      current.includes(evidenceId) ? current.filter((id) => id !== evidenceId) : [...current, evidenceId]
    );
  }

  function requestBody(cell: FlowCell, extra: Record<string, unknown>) {
    return JSON.stringify({
      matchId,
      side: rowSideForCell(cell.id),
      speechType: cell.speechType,
      opponentArgument: cell.content,
      evidenceIds: selectedEvidenceIds,
      ...extra
    });
  }

  async function generateRebuttal(cell: FlowCell) {
    setError(null);
    setCopyStatus(null);
    setSuggestions([]);
    setWeighing([]);
    if (!cell.content.trim()) {
      setError("请先在该单元格填写对方论点，AI 才能给出反驳。");
      return;
    }
    setIsGenerating(true);
    try {
      const response = await fetch("/api/ai/flow/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody(cell, { consentToSendEvidence: consent })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        setError(payload.error ?? "AI 反驳生成失败");
        return;
      }
      const data = payload as { suggestions?: { responses: FlowSuggestion[]; weighing: string[] } };
      setSuggestions(data.suggestions?.responses ?? []);
      setWeighing(data.suggestions?.weighing ?? []);
    } catch {
      setError("AI 反驳生成失败，请检查网络或服务器日志。");
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyPrompt(cell: FlowCell) {
    setError(null);
    setCopyStatus(null);
    if (!cell.content.trim()) {
      setError("请先在该单元格填写对方论点。");
      return;
    }
    try {
      const response = await fetch("/api/ai/flow/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody(cell, { copyPromptOnly: true })
      });
      const payload = (await readJsonResponse(response)) as { error?: string; prompt?: string };
      if (!response.ok || !payload.prompt) {
        setError(payload.error ?? "无法生成 prompt");
        return;
      }
      await navigator.clipboard.writeText(payload.prompt);
      setCopyStatus("Prompt 已复制，可粘贴到 DeepSeek、ChatGPT、Claude 等模型。");
    } catch {
      setError("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  async function insertSuggestion(cell: FlowCell, suggestion: FlowSuggestion) {
    try {
      await addResponse(cell, {
        kind: suggestion.category,
        content: suggestion.response,
        evidenceIds: suggestion.evidenceIds
      });
      setCopyStatus(`已把「${CATEGORY_LABEL[suggestion.category]}」插入为 response，可继续编辑。`);
    } catch {
      setError("插入 response 失败，请重试。");
    }
  }

  if (columns.length === 0) {
    return <p className="empty-state">先创建一场比赛，生成发言列后即可使用 Flow 表。</p>;
  }

  return (
    <div className={`flow-sheet${activeCellId ? " flow-sheet-open" : ""}`}>
      <div className="flow-main">
        <StatusLegend />
        <div className="flow-scroll">
          <div className="flow-grid" style={{ gridTemplateColumns: `minmax(200px, 1.3fr) repeat(${columns.length}, minmax(220px, 1fr))` }}>
            <div className="flow-col-header flow-corner">论点线 / 发言</div>
            {columns.map((column) => (
              <div className="flow-col-header" key={`${column.speechType}-${column.speechOrder}`}>{column.label}</div>
            ))}

            {rows.map((row) => (
              <FlowRowCells
                key={row.id}
                row={row}
                columns={columns}
                evidenceById={evidenceById}
                statusOptions={STATUS_OPTIONS}
                activeCellId={activeCellId}
                onCellChange={updateCell}
                onOpenAssistant={openAssistant}
                onAddResponse={addResponse}
                onResponseChange={updateResponse}
                onResponseDelete={removeResponse}
                onWeighingChange={updateWeighing}
              />
            ))}
          </div>
        </div>

        {rows.length === 0 ? <p className="empty-state">还没有论点行。用上方表单新增一行论点线。</p> : null}
      </div>

      {activeCellId ? (
        <aside className="flow-drawer">
          <FlowAssistant
            cell={findCell(activeCellId)}
            evidence={evidence}
            evidenceById={evidenceById}
            selectedEvidenceIds={selectedEvidenceIds}
            consent={consent}
            isGenerating={isGenerating}
            suggestions={suggestions}
            weighing={weighing}
            error={error}
            copyStatus={copyStatus}
            onToggleEvidence={toggleEvidence}
            onConsentChange={setConsent}
            onGenerate={generateRebuttal}
            onCopyPrompt={copyPrompt}
            onInsert={insertSuggestion}
            onClose={() => setActiveCellId(null)}
          />
        </aside>
      ) : null}
    </div>
  );
}

function StatusLegend() {
  return (
    <div className="flow-legend" aria-label="argument status 图例">
      <span className="flow-legend-title">Status</span>
      {STATUS_LEGEND.map((item) => (
        <span className="flow-legend-item" key={item.status}>
          <span className={`flow-status-dot flow-status-${item.status}`} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

interface FlowRowCellsProps {
  row: FlowRow;
  columns: FlowColumn[];
  evidenceById: Map<string, Evidence>;
  statusOptions: FlowCellStatus[];
  activeCellId: string | null;
  onCellChange: (cellId: string, patch: Partial<FlowCell>, persist: boolean) => void;
  onOpenAssistant: (cellId: string) => void;
  onAddResponse: (cell: FlowCell, init: { kind: FlowResponseKind; content?: string; evidenceIds?: string[] }) => Promise<FlowResponse>;
  onResponseChange: (cellId: string, responseId: string, patch: Partial<FlowResponse>, persist: boolean) => void;
  onResponseDelete: (cellId: string, responseId: string) => void;
  onWeighingChange: (rowId: string, patch: Partial<FlowWeighing>, persist: boolean) => void;
}

function FlowRowCells({
  row,
  columns,
  evidenceById,
  statusOptions,
  activeCellId,
  onCellChange,
  onOpenAssistant,
  onAddResponse,
  onResponseChange,
  onResponseDelete,
  onWeighingChange
}: FlowRowCellsProps) {
  const cellByOrder = new Map(row.cells.map((cell) => [cell.speechOrder, cell]));
  const riskyCount = row.cells.reduce(
    (sum, cell) =>
      sum +
      (RISKY_STATUSES.includes(cell.status) ? 1 : 0) +
      cell.responses.filter((response) => RISKY_STATUSES.includes(response.status)).length,
    0
  );

  return (
    <>
      <div className="flow-row-head">
        <div className="flow-row-head-top">
          <span className="pill">{row.side}</span>
          {riskyCount > 0 ? <span className="flow-risk-badge" title="dropped / conceded 数量">⚠ {riskyCount}</span> : null}
        </div>
        <strong>{row.title || "未命名论点"}</strong>
        {row.category && row.category !== "general" ? <span className="small-note">{row.category}</span> : null}
        <WeighingPanel row={row} onWeighingChange={onWeighingChange} />
        <form action={deleteFlowRow}>
          <input type="hidden" name="flowRowId" value={row.id} />
          <button className="link-button danger" type="submit">删除行</button>
        </form>
      </div>
      {columns.map((column) => {
        const cell = cellByOrder.get(column.speechOrder);
        if (!cell) {
          return <div className="flow-cell flow-cell-empty" key={`${row.id}-${column.speechOrder}`} />;
        }
        return (
          <div className={`flow-cell${activeCellId === cell.id ? " flow-cell-active" : ""}`} key={cell.id}>
            <textarea
              value={cell.content}
              rows={3}
              placeholder="记录论点 / 反驳..."
              onChange={(event) => onCellChange(cell.id, { content: event.target.value }, false)}
              onBlur={(event) => onCellChange(cell.id, { content: event.target.value }, true)}
            />
            <div className="flow-cell-foot">
              <div className="flow-status-wrap">
                <span className={`flow-status-dot flow-status-${cell.status}`} aria-hidden="true" />
                <select
                  className={`flow-status flow-status-${cell.status}`}
                  value={cell.status}
                  onChange={(event) => onCellChange(cell.id, { status: event.target.value as FlowCellStatus }, true)}
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
              <button className="link-button" type="button" onClick={() => onOpenAssistant(cell.id)}>AI 反驳</button>
            </div>
            {cell.evidenceIds.length ? (
              <div className="flow-evidence-chips">
                {cell.evidenceIds.map((id) => (
                  <EvidenceChip key={id} evidenceId={id} evidence={evidenceById.get(id)} />
                ))}
              </div>
            ) : null}

            <CellResponses
              cell={cell}
              evidenceById={evidenceById}
              statusOptions={statusOptions}
              onAddResponse={onAddResponse}
              onResponseChange={onResponseChange}
              onResponseDelete={onResponseDelete}
            />
          </div>
        );
      })}
    </>
  );
}

interface WeighingPanelProps {
  row: FlowRow;
  onWeighingChange: (rowId: string, patch: Partial<FlowWeighing>, persist: boolean) => void;
}

function WeighingPanel({ row, onWeighingChange }: WeighingPanelProps) {
  const filled = WEIGHING_FIELDS.filter((field) => row.weighing[field.key].trim()).length;
  const [open, setOpen] = useState(filled > 0);

  return (
    <div className="flow-weigh-panel">
      <button className="flow-weigh-toggle" type="button" onClick={() => setOpen((value) => !value)}>
        <span>Weighing</span>
        <span className="flow-weigh-count">{filled}/4</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="flow-weigh-grid">
          {WEIGHING_FIELDS.map((field) => (
            <label className="flow-weigh-field" key={field.key}>
              <span>{field.label}</span>
              <input
                value={row.weighing[field.key]}
                placeholder={field.placeholder}
                onChange={(event) => onWeighingChange(row.id, { [field.key]: event.target.value }, false)}
                onBlur={(event) => onWeighingChange(row.id, { [field.key]: event.target.value }, true)}
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface CellResponsesProps {
  cell: FlowCell;
  evidenceById: Map<string, Evidence>;
  statusOptions: FlowCellStatus[];
  onAddResponse: (cell: FlowCell, init: { kind: FlowResponseKind; content?: string; evidenceIds?: string[] }) => Promise<FlowResponse>;
  onResponseChange: (cellId: string, responseId: string, patch: Partial<FlowResponse>, persist: boolean) => void;
  onResponseDelete: (cellId: string, responseId: string) => void;
}

function CellResponses({ cell, evidenceById, statusOptions, onAddResponse, onResponseChange, onResponseDelete }: CellResponsesProps) {
  const [adding, setAdding] = useState(false);

  async function add(kind: FlowResponseKind) {
    setAdding(true);
    try {
      await onAddResponse(cell, { kind });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flow-responses">
      {cell.responses.length ? (
        <ol className="flow-response-list">
          {cell.responses.map((response, index) => (
            <li className="flow-response" key={response.id}>
              <div className="flow-response-head">
                <span className="flow-response-index">R{index + 1}</span>
                <select
                  className={`flow-kind-badge flow-kind-${response.kind}`}
                  value={response.kind}
                  onChange={(event) => onResponseChange(cell.id, response.id, { kind: event.target.value as FlowResponseKind }, true)}
                >
                  {RESPONSE_KIND_OPTIONS.map((kind) => (
                    <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>
                  ))}
                </select>
                <span className="flow-response-spacer" />
                <span className={`flow-status-dot flow-status-${response.status}`} aria-hidden="true" />
                <select
                  className={`flow-status flow-status-${response.status}`}
                  value={response.status}
                  onChange={(event) => onResponseChange(cell.id, response.id, { status: event.target.value as FlowCellStatus }, true)}
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
                <button className="link-button danger" type="button" onClick={() => onResponseDelete(cell.id, response.id)} aria-label="删除 response">×</button>
              </div>
              <textarea
                value={response.content}
                rows={2}
                placeholder="逐条回应..."
                onChange={(event) => onResponseChange(cell.id, response.id, { content: event.target.value }, false)}
                onBlur={(event) => onResponseChange(cell.id, response.id, { content: event.target.value }, true)}
              />
              {response.evidenceIds.length ? (
                <div className="flow-evidence-chips">
                  {response.evidenceIds.map((id) => (
                    <EvidenceChip key={id} evidenceId={id} evidence={evidenceById.get(id)} />
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flow-response-add">
        <span className="small-note">+ 回应</span>
        {RESPONSE_KIND_OPTIONS.map((kind) => (
          <button
            className={`flow-kind-add flow-kind-${kind}`}
            type="button"
            key={kind}
            disabled={adding}
            onClick={() => add(kind)}
          >
            {KIND_LABEL[kind]}
          </button>
        ))}
      </div>
    </div>
  );
}

interface EvidenceChipProps {
  evidenceId: string;
  evidence: Evidence | undefined;
}

function EvidenceChip({ evidenceId, evidence }: EvidenceChipProps) {
  const [open, setOpen] = useState(false);

  if (!evidence) {
    return <span className="pill flow-chip flow-chip-missing" title="证据卡不在当前 workspace">{evidenceId}</span>;
  }

  return (
    <span className="flow-chip-wrap">
      <button className="pill flow-chip" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {evidence.title}
      </button>
      {open ? (
        <span className="flow-chip-pop" role="dialog">
          <span className="flow-chip-pop-head">
            <strong>{evidence.title}</strong>
            <button className="link-button" type="button" onClick={() => setOpen(false)} aria-label="关闭">×</button>
          </span>
          {evidence.claim ? <span className="flow-chip-claim">{evidence.claim}</span> : null}
          {evidence.quote ? <span className="flow-chip-quote">“{evidence.quote}”</span> : null}
          <span className="flow-chip-meta">
            {[evidence.author, evidence.publication, evidence.publishedDate].filter(Boolean).join(" · ") || "无来源信息"}
          </span>
          {evidence.sourceUrl ? (
            <a className="flow-chip-link" href={evidence.sourceUrl} target="_blank" rel="noreferrer">查看原文 ↗</a>
          ) : (
            <span className="small-note">未填写 source URL</span>
          )}
        </span>
      ) : null}
    </span>
  );
}

interface FlowAssistantProps {
  cell: FlowCell | undefined;
  evidence: Evidence[];
  evidenceById: Map<string, Evidence>;
  selectedEvidenceIds: string[];
  consent: boolean;
  isGenerating: boolean;
  suggestions: FlowSuggestion[];
  weighing: string[];
  error: string | null;
  copyStatus: string | null;
  onToggleEvidence: (evidenceId: string) => void;
  onConsentChange: (value: boolean) => void;
  onGenerate: (cell: FlowCell) => void;
  onCopyPrompt: (cell: FlowCell) => void;
  onInsert: (cell: FlowCell, suggestion: FlowSuggestion) => void;
  onClose: () => void;
}

function FlowAssistant({
  cell,
  evidence,
  evidenceById,
  selectedEvidenceIds,
  consent,
  isGenerating,
  suggestions,
  weighing,
  error,
  copyStatus,
  onToggleEvidence,
  onConsentChange,
  onGenerate,
  onCopyPrompt,
  onInsert,
  onClose
}: FlowAssistantProps) {
  if (!cell) {
    return null;
  }

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: suggestions.filter((suggestion) => suggestion.category === category)
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flow-assistant">
      <div className="flow-assistant-head">
        <strong>AI 反驳 · {cell.speechType}</strong>
        <button className="link-button" type="button" onClick={onClose}>收起</button>
      </div>
      <p className="small-note">对方论点：{cell.content.trim() || "（先在单元格填写对方论点）"}</p>
      <div className="evidence-picker">
        {evidence.map((card) => (
          <label className="check-card" key={card.id}>
            <input
              type="checkbox"
              checked={selectedEvidenceIds.includes(card.id)}
              onChange={() => onToggleEvidence(card.id)}
            />
            <span>
              <strong>{card.title}</strong>
              <small>{card.side} · {card.tags.join(", ")}</small>
            </span>
          </label>
        ))}
        {evidence.length === 0 ? <p className="small-note">证据库还没有卡片，AI 仍可给出策略但不会引用来源。</p> : null}
      </div>
      <label className="consent-row">
        <input type="checkbox" checked={consent} onChange={(event) => onConsentChange(event.target.checked)} />
        <span>我同意把对方论点和选中的 {selectedEvidenceIds.length} 条 evidence 发送给服务器端 AI provider。API key 不进入浏览器。</span>
      </label>
      <div className="actions">
        <button className="button primary" type="button" disabled={!consent || isGenerating} onClick={() => onGenerate(cell)}>
          {isGenerating ? "生成中..." : "生成反驳建议"}
        </button>
        <button className="button" type="button" disabled={isGenerating} onClick={() => onCopyPrompt(cell)}>
          Copy prompt
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {copyStatus ? <p className="success-text">{copyStatus}</p> : null}
      {grouped.length ? (
        <div className="flow-suggestions">
          {grouped.map((group) => (
            <section className="flow-suggestion-group" key={group.category}>
              <h4 className={`flow-cat-title flow-kind-${group.category}`}>{CATEGORY_LABEL[group.category]}</h4>
              {group.items.map((suggestion, index) => (
                <article className="flow-suggestion" key={`${suggestion.label}-${index}`}>
                  <div className="evidence-meta">
                    <span className={`flow-kind-badge flow-kind-${suggestion.category}`}>{KIND_LABEL[suggestion.category]}</span>
                    <span className="pill">{suggestion.label}</span>
                    {suggestion.strategy ? <span className="pill">{suggestion.strategy}</span> : null}
                  </div>
                  <p>{suggestion.response}</p>
                  {suggestion.evidenceIds.length ? (
                    <div className="flow-evidence-chips">
                      {suggestion.evidenceIds.map((id) => (
                        <EvidenceChip key={id} evidenceId={id} evidence={evidenceById.get(id)} />
                      ))}
                    </div>
                  ) : null}
                  <button className="button" type="button" onClick={() => onInsert(cell, suggestion)}>插入为 response</button>
                </article>
              ))}
            </section>
          ))}
          {weighing.length ? (
            <div className="flow-weighing">
              <strong>Weighing</strong>
              <ul>{weighing.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
