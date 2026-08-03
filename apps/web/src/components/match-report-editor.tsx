"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import { useRouter } from "next/navigation";
import { formatOptions, type ArgumentOutcome, type Side } from "@debate/shared";
import type { MatchReportView } from "@/lib/match-reports";
import {
  saveMatchReportAction,
  type MatchReportActionState
} from "@/app/app/history/actions";

type EvidenceOption = MatchReportView["evidenceOptions"][number];

interface MatchReportEditorProps {
  report: MatchReportView | null;
  evidenceOptions?: EvidenceOption[];
  defaultDate: string;
}

interface EditorArgument {
  key: string;
  argument: string;
  side: Side;
  category: string;
  outcome: ArgumentOutcome | "";
  confidence: number;
  notes: string;
  suggested: boolean;
}

interface EditorEvidence extends EvidenceOption {
  selected: boolean;
}

const initialActionState: MatchReportActionState = { ok: false, message: "" };
const sideOptions: Side[] = ["Aff", "Neg", "Pro", "Con", "Generic"];
const outcomeOptions: Array<{ value: ArgumentOutcome; label: string }> = [
  { value: "won", label: "赢下" },
  { value: "lost", label: "失守" },
  { value: "dropped", label: "对方掉点" },
  { value: "turned", label: "完成转点" },
  { value: "conceded", label: "我方让步" }
];

function formatSubmittedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai"
  }).format(new Date(value));
}

function initialArguments(report: MatchReportView | null): EditorArgument[] {
  return (report?.argumentOutcomes ?? []).map((argument, index) => ({
    key: argument.id ?? `suggested-${argument.position}-${index}`,
    argument: argument.argument,
    side: argument.side,
    category: argument.category,
    outcome: argument.outcome ?? "",
    confidence: argument.confidence,
    notes: argument.notes,
    suggested: argument.suggested
  }));
}

export function MatchReportEditor({ report, evidenceOptions = [], defaultDate }: MatchReportEditorProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveMatchReportAction, initialActionState);
  const [argumentsList, setArgumentsList] = useState<EditorArgument[]>(() => initialArguments(report));
  const [evidence, setEvidence] = useState<EditorEvidence[]>(() => (report?.evidenceOptions ?? evidenceOptions).map((item) => ({ ...item })));
  const [evidenceQuery, setEvidenceQuery] = useState("");
  const canEdit = report?.canEdit ?? true;
  const selectedEvidenceCount = evidence.filter((item) => item.selected).length;
  const reportId = report?.id ?? null;
  const expectedRevision = state.ok && state.reportRevision !== undefined
    ? state.reportRevision
    : (report?.reportRevision ?? 0);

  useEffect(() => {
    if (!state.ok || !state.matchId) return;
    if (!reportId) {
      router.replace(`/app/history?match=${encodeURIComponent(state.matchId)}`);
      return;
    }
    router.refresh();
  }, [reportId, router, state.matchId, state.ok, state.reportRevision]);

  const visibleEvidence = useMemo(() => {
    if (!canEdit) return evidence.filter((item) => item.selected);
    const query = evidenceQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query) return evidence;
    return evidence.filter((item) => [item.title, item.claim, item.documentTitle, item.uploaderName]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(query)));
  }, [canEdit, evidence, evidenceQuery]);

  function updateArgument(key: string, patch: Partial<EditorArgument>) {
    setArgumentsList((current) => current.map((item) => item.key === key ? { ...item, ...patch, suggested: false } : item));
  }

  function addArgument() {
    setArgumentsList((current) => [
      ...current,
      {
        key: `argument-${Date.now()}-${current.length}`,
        argument: "",
        side: report?.side ?? "Generic",
        category: "general",
        outcome: "",
        confidence: 3,
        notes: "",
        suggested: false
      }
    ]);
  }

  function updateEvidence(evidenceId: string, patch: Partial<EditorEvidence>) {
    setEvidence((current) => current.map((item) => item.evidenceId === evidenceId ? { ...item, ...patch } : item));
  }

  function hasFieldError(name: string) {
    return Object.keys(state.fieldErrors ?? {}).some((key) => key === name || key.endsWith(`.${name}`));
  }

  function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const serializedArguments = JSON.stringify(argumentsList.map((argument) => ({
    argument: argument.argument,
    side: argument.side,
    category: argument.category,
    outcome: argument.outcome,
    confidence: argument.confidence,
    notes: argument.notes
  })));
  const serializedEvidence = JSON.stringify(evidence
    .filter((item) => item.selected)
    .map((item) => ({
      evidenceId: item.evidenceId,
      speechType: item.speechType,
      effectivenessRating: item.effectivenessRating,
      notes: item.notes
    })));

  return (
    <section className="report-editor" aria-labelledby="report-editor-title">
      <div className="report-editor-head">
        <div>
          <div className="eyebrow">{report ? "Match Report" : "Manual Entry"}</div>
          <h2 id="report-editor-title">{report ? `${report.tournament} vs ${report.opponent}` : "补录历史比赛"}</h2>
          {report ? (
            <p>
              {report.reportSubmittedAt
                ? `首次提交于 ${formatSubmittedAt(report.reportSubmittedAt)} · 当前第 ${report.reportRevision} 版`
                : "尚未提交赛后报告"}
            </p>
          ) : null}
        </div>
        <div className="report-status-row">
          {report?.access === "room" ? <span className="pill report-access-pill">房间共享</span> : null}
          <span className={`report-status ${report?.reportSubmittedAt ? "submitted" : "pending"}`}>
            {report?.reportSubmittedAt ? "已提交" : "待复盘"}
          </span>
          {!canEdit ? <span className="pill">只读</span> : null}
        </div>
      </div>

      <form onSubmit={submitReport} className="report-form">
        <input type="hidden" name="targetKind" value={report ? "existing" : "historical"} />
        <input type="hidden" name="matchId" value={report?.id ?? ""} />
        <input type="hidden" name="expectedRevision" value={expectedRevision} />
        <input type="hidden" name="argumentOutcomesJson" value={serializedArguments} />
        <input type="hidden" name="evidenceJson" value={serializedEvidence} />

        <fieldset className="report-fieldset" disabled={!canEdit || pending}>
          <section className="report-form-section" aria-labelledby="report-match-heading">
            <div className="report-section-heading">
              <div>
                <h3 id="report-match-heading">比赛信息</h3>
                {report?.createdBy ? <p>记录人：{report.createdBy.name}</p> : null}
              </div>
            </div>
            <div className="form-grid two-columns report-meta-grid">
              <label className="field">
                <span>赛事</span>
                <input name="tournament" defaultValue={report?.tournament ?? ""} required aria-invalid={hasFieldError("tournament")} />
              </label>
              <label className="field">
                <span>对手</span>
                <input name="opponent" defaultValue={report?.opponent ?? ""} required aria-invalid={hasFieldError("opponent")} />
              </label>
              <label className="field report-topic-field">
                <span>辩题</span>
                <input name="topic" defaultValue={report?.topic ?? ""} required aria-invalid={hasFieldError("topic")} />
              </label>
              <label className="field">
                <span>日期</span>
                <input name="date" type="date" defaultValue={report?.date ?? defaultDate} required aria-invalid={hasFieldError("date")} />
              </label>
              <label className="field">
                <span>赛制</span>
                <select name="format" defaultValue={report?.format ?? "PF"}>
                  {formatOptions.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>立场</span>
                <select name="side" defaultValue={report?.side ?? "Generic"}>
                  {sideOptions.map((side) => <option value={side} key={side}>{side}</option>)}
                </select>
              </label>
              <label className="field">
                <span>轮次</span>
                <input name="roundNumber" defaultValue={report?.roundNumber ?? ""} placeholder="例如 R3" />
              </label>
              <label className="field">
                <span>评委</span>
                <input name="judge" defaultValue={report?.judge ?? ""} />
              </label>
              <label className="field report-topic-field">
                <span>标签</span>
                <input name="tags" defaultValue={(report?.tags ?? []).join(", ")} placeholder="weighing, economy" />
              </label>
            </div>
            <div className="field">
              <span>比赛结果</span>
              <div className="result-segmented" role="radiogroup" aria-label="比赛结果">
                {[
                  { value: "pending", label: "待定" },
                  { value: "win", label: "胜利" },
                  { value: "loss", label: "失利" }
                ].map((option) => (
                  <label key={option.value}>
                    <input type="radio" name="result" value={option.value} defaultChecked={(report?.result ?? "pending") === option.value} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section className="report-form-section" aria-labelledby="report-arguments-heading">
            <div className="report-section-heading">
              <div>
                <h3 id="report-arguments-heading">论点结果</h3>
                <p>{argumentsList.length} 条结构化记录</p>
              </div>
              {canEdit ? <button className="button report-add-button" type="button" onClick={addArgument}>＋ 添加论点</button> : null}
            </div>
            <div className="argument-editor-list">
              {argumentsList.map((argument, index) => (
                <article className="argument-editor-row" key={argument.key}>
                  <div className="argument-editor-index" aria-hidden="true">{index + 1}</div>
                  <div className="argument-editor-fields">
                    <div className="argument-title-row">
                      <label className="field">
                        <span>论点</span>
                        <input value={argument.argument} onChange={(event) => updateArgument(argument.key, { argument: event.target.value })} required />
                      </label>
                      {argument.suggested ? <span className="pill">来自 Flow</span> : null}
                      {canEdit ? (
                        <button
                          className="icon-button"
                          type="button"
                          title="删除论点"
                          aria-label={`删除第 ${index + 1} 条论点`}
                          onClick={() => setArgumentsList((current) => current.filter((item) => item.key !== argument.key))}
                        >×</button>
                      ) : null}
                    </div>
                    <div className="argument-control-grid">
                      <label className="field"><span>立场</span><select value={argument.side} onChange={(event) => updateArgument(argument.key, { side: event.target.value as Side })}>{sideOptions.map((side) => <option key={side}>{side}</option>)}</select></label>
                      <label className="field"><span>类别</span><input value={argument.category} onChange={(event) => updateArgument(argument.key, { category: event.target.value })} /></label>
                      <label className="field"><span>结果</span><select value={argument.outcome} onChange={(event) => updateArgument(argument.key, { outcome: event.target.value as ArgumentOutcome | "" })} required><option value="">请选择</option>{outcomeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
                      <label className="field"><span>信心度</span><select value={argument.confidence} onChange={(event) => updateArgument(argument.key, { confidence: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((rating) => <option value={rating} key={rating}>{rating}</option>)}</select></label>
                    </div>
                    <label className="field"><span>备注</span><textarea rows={2} value={argument.notes} onChange={(event) => updateArgument(argument.key, { notes: event.target.value })} /></label>
                  </div>
                </article>
              ))}
              {argumentsList.length === 0 ? <p className="empty-state">尚未记录论点结果。</p> : null}
            </div>
          </section>

          <section className="report-form-section" aria-labelledby="report-evidence-heading">
            <div className="report-section-heading">
              <div>
                <h3 id="report-evidence-heading">Evidence 评价</h3>
                <p>{selectedEvidenceCount} 条已选 evidence</p>
              </div>
              {canEdit && evidence.length ? (
                <label className="report-evidence-search">
                  <span className="sr-only">搜索 evidence</span>
                  <input type="search" value={evidenceQuery} onChange={(event) => setEvidenceQuery(event.target.value)} placeholder="搜索 evidence" />
                </label>
              ) : null}
            </div>
            <div className="report-evidence-list">
              {visibleEvidence.map((item) => (
                <article className="report-evidence-row" data-selected={item.selected} key={item.evidenceId}>
                  <div className="report-evidence-summary">
                    <label className="check-field">
                      <input type="checkbox" checked={item.selected} onChange={(event) => updateEvidence(item.evidenceId, { selected: event.target.checked })} />
                      <span>{item.title}</span>
                    </label>
                    <span className="pill">{item.side}</span>
                  </div>
                  <p>{item.claim}</p>
                  {item.documentTitle || item.uploaderName || item.sourceUrl ? (
                    <div className="report-evidence-meta">
                      {item.documentTitle || item.uploaderName ? <span>{[item.documentTitle, item.uploaderName].filter(Boolean).join(" · ")}</span> : null}
                      {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">查看来源 ↗</a> : null}
                    </div>
                  ) : null}
                  {item.selected ? (
                    <div className="report-evidence-controls">
                      <label className="field"><span>发言环节</span><input value={item.speechType ?? ""} onChange={(event) => updateEvidence(item.evidenceId, { speechType: event.target.value || null })} /></label>
                      <label className="field"><span>效果评分</span><select required value={item.effectivenessRating ?? ""} onChange={(event) => updateEvidence(item.evidenceId, { effectivenessRating: event.target.value ? Number(event.target.value) : null })}><option value="">请选择评分</option>{[1, 2, 3, 4, 5].map((rating) => <option value={rating} key={rating}>{rating}</option>)}</select></label>
                      <label className="field report-evidence-notes"><span>评价备注</span><textarea rows={2} value={item.notes} onChange={(event) => updateEvidence(item.evidenceId, { notes: event.target.value })} /></label>
                    </div>
                  ) : null}
                </article>
              ))}
              {visibleEvidence.length === 0 ? <p className="empty-state">没有可评价的 evidence。</p> : null}
            </div>
          </section>

          <section className="report-form-section" aria-labelledby="report-reflection-heading">
            <div className="report-section-heading">
              <div><h3 id="report-reflection-heading">结构化复盘</h3></div>
            </div>
            <div className="reflection-grid">
              <label className="field"><span>有效做法</span><textarea name="whatWorked" rows={5} defaultValue={report?.reflection.whatWorked ?? ""} /></label>
              <label className="field"><span>失误与不足</span><textarea name="whatFailed" rows={5} defaultValue={report?.reflection.whatFailed ?? ""} /></label>
              <label className="field"><span>评委反馈</span><textarea name="judgeFeedback" rows={5} defaultValue={report?.reflection.judgeFeedback ?? ""} /></label>
              <label className="field"><span>下一步训练</span><textarea name="nextSteps" rows={5} defaultValue={report?.reflection.nextSteps ?? ""} /></label>
            </div>
          </section>
        </fieldset>

        {state.message ? (
          <div className={state.ok ? "report-feedback success" : "report-feedback error"} role="status">
            <p>{state.message}</p>
            {!state.ok && state.fieldErrors && Object.keys(state.fieldErrors).length ? (
              <ul>{Array.from(new Set(Object.values(state.fieldErrors))).map((message) => <li key={message}>{message}</li>)}</ul>
            ) : null}
            {state.code === "REVISION_CONFLICT" ? <button className="button" type="button" onClick={() => window.location.reload()}>重新加载服务器版本</button> : null}
          </div>
        ) : null}

        {canEdit ? (
          <div className="report-submit-row">
            <span>{report?.reportSubmittedAt ? `将保存为第 ${expectedRevision + 1} 版` : "首次提交后将纳入赛事统计"}</span>
            <button className="button primary" type="submit" disabled={pending}>{pending ? "保存中…" : report?.reportSubmittedAt ? "保存修订" : "提交赛后报告"}</button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
