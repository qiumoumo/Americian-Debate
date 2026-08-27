import { ReliableLink } from "@/components/reliable-link";
import type { MatchResult, Side } from "@debate/shared";
import { AppShell } from "@/components/app-shell";
import { MatchOutcomeDistribution } from "@/components/match-outcome-distribution";
import { MatchReportEditor } from "@/components/match-report-editor";
import { StatCard } from "@/components/stat-card";
import { requireUser } from "@/lib/auth";
import { getEvidenceForWorkspace } from "@/lib/data";
import {
  getMatchHistory,
  getMatchReport,
  type MatchHistoryFilters,
  type MatchHistoryItem,
  type MatchReportEvidenceOption,
  type MatchReportView
} from "@/lib/match-reports";
import { sessionShellUser } from "@/lib/session-props";

interface HistorySearchParams {
  q?: string;
  result?: string;
  side?: string;
  from?: string;
  to?: string;
  match?: string;
  new?: string;
}

const resultValues = new Set(["all", "win", "loss", "pending"]);
const sideValues = new Set(["all", "Aff", "Neg", "Pro", "Con", "Generic"]);

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? undefined : value;
}

function filtersFrom(params: HistorySearchParams): MatchHistoryFilters {
  const keyword = params.q?.trim();
  const result = resultValues.has(params.result ?? "") ? params.result as MatchResult | "all" : "all";
  const side = sideValues.has(params.side ?? "") ? params.side as Side | "all" : "all";
  const dateFrom = validDate(params.from);
  const dateTo = validDate(params.to);
  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  return {
    keyword: keyword || undefined,
    result,
    side,
    dateFrom: invalidDateRange ? undefined : dateFrom,
    dateTo: invalidDateRange ? undefined : dateTo
  };
}

function filterQuery(params: HistorySearchParams) {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (resultValues.has(params.result ?? "") && params.result !== "all") query.set("result", params.result!);
  if (sideValues.has(params.side ?? "") && params.side !== "all") query.set("side", params.side!);
  const dateFrom = validDate(params.from);
  const dateTo = validDate(params.to);
  if (!(dateFrom && dateTo && dateFrom > dateTo)) {
    if (dateFrom) query.set("from", dateFrom);
    if (dateTo) query.set("to", dateTo);
  }
  return query;
}

function selectionHref(params: HistorySearchParams, selection: { match?: string; isNew?: boolean }) {
  const query = filterQuery(params);
  if (selection.match) query.set("match", selection.match);
  if (selection.isNew) query.set("new", "1");
  const suffix = query.toString();
  return suffix ? `/app/history?${suffix}` : "/app/history";
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Shanghai" })
    .format(new Date(`${value}T00:00:00.000Z`));
}

function resultLabel(result: MatchResult) {
  if (result === "win") return "胜利";
  if (result === "loss") return "失利";
  return "待定";
}

function selectionErrorMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "无法读取这份赛后报告。";
  if (error.code === "NOT_FOUND") return "未找到这场比赛，记录可能已被删除。";
  if (error.code === "FORBIDDEN") return "你没有权限查看这份赛后报告。";
  return "无法读取这份赛后报告。";
}

function HistoryRow({ item, active, href }: { item: MatchHistoryItem; active: boolean; href: string }) {
  return (
    <ReliableLink className="history-record-row" data-active={active} href={href}>
      <div className="history-record-head" data-language-raw>
        <strong>{item.tournament} vs {item.opponent}</strong>
        <span className={`result-badge ${item.result}`}>{resultLabel(item.result)}</span>
      </div>
      <p data-language-raw>{item.topic}</p>
      <div className="history-record-meta">
        <time dateTime={item.date}>{dateLabel(item.date)}</time>
        <span>{item.format} · {item.side}</span>
        <span>{item.argumentOutcomeCount} 论点 · {item.evidenceCount} evidence</span>
      </div>
    </ReliableLink>
  );
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<HistorySearchParams> }) {
  const session = await requireUser();
  const params = await searchParams;
  const actor = { userId: session.user.id, workspaceId: session.workspace.id };
  const requestedMatchId = params.match?.trim() || null;
  const isNew = params.new === "1";
  const canCreate = session.role !== "VIEWER";

  const historyPromise = getMatchHistory(actor, filtersFrom(params));
  const reportPromise: Promise<{ report: MatchReportView | null; error: string | null }> = requestedMatchId && !isNew
    ? getMatchReport(actor, requestedMatchId)
        .then((report) => ({ report, error: null }))
        .catch((error: unknown) => ({ report: null, error: selectionErrorMessage(error) }))
    : Promise.resolve({ report: null, error: null });
  const manualEvidencePromise: Promise<MatchReportEvidenceOption[]> = isNew && canCreate
    ? getEvidenceForWorkspace({ workspaceId: session.workspace.id, userId: session.user.id, scope: "workspace" }).then((evidence) => evidence.map((item) => ({
        evidenceId: item.id,
        title: item.title,
        claim: item.claim,
        quote: item.quote,
        sourceUrl: item.sourceUrl,
        side: item.side,
        documentTitle: "",
        uploaderName: item.uploaderName ?? "",
        selected: false,
        speechType: null,
        effectivenessRating: null,
        notes: ""
      })))
    : Promise.resolve([]);

  const [history, selection, manualEvidence] = await Promise.all([historyPromise, reportPromise, manualEvidencePromise]);
  const selectionError = isNew && !canCreate ? "只读成员不能补录历史比赛。" : selection.error;
  const dateFrom = validDate(params.from);
  const dateTo = validDate(params.to);
  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const defaultDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai"
  }).format(new Date());

  return (
    <AppShell
      activeHref="/app/history"
      user={sessionShellUser(session)}
      note="赛事统计只计算已提交的赛后报告；结果待定的比赛计入场次，但不进入胜率分母。"
    >
      <section className="hero history-hero">
        <div className="eyebrow">Match History</div>
        <h1>赛事记录与复盘</h1>
        <p>集中查看赛后数据、论点结果、evidence 表现与训练复盘。</p>
        <div className="actions">
          {canCreate ? <ReliableLink className="button primary" href={selectionHref(params, { isNew: true })}>补录比赛</ReliableLink> : null}
          <ReliableLink className="button" href="/app/matches">进入比赛房间</ReliableLink>
        </div>
      </section>

      <div className="grid three history-stats">
        <StatCard label="总体胜率" value={`${history.stats.winRate}%`} note={`${history.stats.rounds} 场已提交 · ${history.stats.decidedRounds} 场已判定`} />
        <StatCard label="Aff / Pro" value={`${history.stats.affWinRate}%`} note="正方或支持方胜率" />
        <StatCard label="Neg / Con" value={`${history.stats.negWinRate}%`} note="反方或反对方胜率" />
      </div>

      {invalidDateRange ? <p className="form-error" role="alert">结束日期不能早于开始日期；本次暂未应用日期筛选。</p> : null}
      <form className="match-history-filters" method="get">
        <label className="field history-filter-query"><span>关键词</span><input type="search" name="q" defaultValue={params.q ?? ""} placeholder="赛事、对手、辩题、评委" /></label>
        <label className="field"><span>结果</span><select name="result" defaultValue={resultValues.has(params.result ?? "") ? params.result : "all"}><option value="all">全部结果</option><option value="win">胜利</option><option value="loss">失利</option><option value="pending">待定</option></select></label>
        <label className="field"><span>立场</span><select name="side" defaultValue={sideValues.has(params.side ?? "") ? params.side : "all"}><option value="all">全部立场</option><option>Aff</option><option>Neg</option><option>Pro</option><option>Con</option><option>Generic</option></select></label>
        <label className="field"><span>开始日期</span><input type="date" name="from" max={dateTo} defaultValue={dateFrom ?? ""} /></label>
        <label className="field"><span>结束日期</span><input type="date" name="to" min={dateFrom} defaultValue={dateTo ?? ""} /></label>
        <div className="history-filter-actions"><button className="button primary" type="submit">筛选</button><ReliableLink className="button ghost" href="/app/history">清除</ReliableLink></div>
      </form>

      <section className="pending-review-section" aria-labelledby="pending-review-heading">
        <div className="section-title">
          <div><h2 id="pending-review-heading">待复盘</h2><p>{`${history.pending.length} 场比赛尚未提交赛后数据`}</p></div>
        </div>
        {history.pending.length ? (
          <div className="pending-review-list">
            {history.pending.map((item) => (
              <ReliableLink className="pending-review-row" href={selectionHref(params, { match: item.id })} key={item.id}>
                <div data-language-raw><strong>{item.tournament} vs {item.opponent}</strong><p>{item.topic}</p></div>
                <div className="pending-review-action"><time dateTime={item.date}>{dateLabel(item.date)}</time><span>{item.canEdit ? "填写复盘" : "查看"} →</span></div>
              </ReliableLink>
            ))}
          </div>
        ) : <p className="empty-state">当前没有待复盘的比赛。</p>}
      </section>

      <div className="match-history-workspace">
        <aside className="history-record-index" aria-labelledby="history-record-heading">
          <div className="section-title">
            <div><h2 id="history-record-heading">已提交报告</h2><p>{`${history.reports.length} 条筛选结果`}</p></div>
          </div>
          <div className="history-record-list">
            {history.reports.map((item) => (
              <HistoryRow item={item} active={requestedMatchId === item.id && !isNew} href={selectionHref(params, { match: item.id })} key={item.id} />
            ))}
            {history.reports.length === 0 ? <p className="empty-state">没有符合条件的已提交报告。</p> : null}
          </div>
        </aside>

        <section className="history-report-detail" aria-label="赛后报告详情">
          {selectionError ? (
            <div className="report-selection-state error" role="alert"><strong>无法打开报告</strong><p>{selectionError}</p><ReliableLink className="button" href={selectionHref(params, {})}>返回记录列表</ReliableLink></div>
          ) : isNew ? (
            <MatchReportEditor key="new" report={null} evidenceOptions={manualEvidence} defaultDate={defaultDate} />
          ) : selection.report ? (
            <MatchReportEditor key={selection.report.id} report={selection.report} defaultDate={defaultDate} />
          ) : (
            <div className="report-selection-state"><strong>选择一场比赛</strong><p>打开已提交报告，或从待复盘列表继续填写。</p></div>
          )}
        </section>
      </div>

      <MatchOutcomeDistribution outcomes={history.stats.argumentOutcomes} />
    </AppShell>
  );
}
