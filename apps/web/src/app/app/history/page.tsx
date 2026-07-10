import { AppShell } from "@/components/app-shell";
import Link from "next/link";
import { ChartPlaceholder } from "@/components/chart-placeholder";
import { SectionCard } from "@/components/section-card";
import { StatCard } from "@/components/stat-card";
import { saveReflection } from "./actions";
import { computeMatchStats, getMatchesForWorkspace } from "@/lib/data";
import { requireUser } from "@/lib/auth";
import { db } from "@debate/db";
import { sessionShellUser } from "@/lib/session-props";

export default async function HistoryPage() {
  const session = await requireUser();
  const matches = await getMatchesForWorkspace(session.workspace.id);
  const stats = computeMatchStats(matches);
  const rawMatches = await db.match.findMany({
    where: { workspaceId: session.workspace.id, deletedAt: null },
    include: { reflection: true },
    orderBy: { updatedAt: "desc" }
  });

  return (
    <AppShell activeHref="/app/history" user={sessionShellUser(session)} note="统计来自结构化 match outcomes 和比赛结果，而不是让 AI 凭空总结。">
      <section className="hero">
        <div className="eyebrow">Match History</div>
        <h1>赛事记录</h1>
        <p>
          每场比赛保存笔记、tag、反思和 argument outcomes。图表仍是占位，但统计数字已从 SQLite 聚合。
        </p>
      </section>

      <div className="grid three">
        <StatCard label="Overall" value={`${stats.winRate}%`} note={`${stats.rounds} 场比赛`} />
        <StatCard label="Aff / Pro" value={`${stats.affWinRate}%`} note="正方或支持方胜率" />
        <StatCard label="Neg / Con" value={`${stats.negWinRate}%`} note="反方或反对方胜率" />
      </div>

      <div style={{ height: 18 }} />

      <div className="grid two">
        <SectionCard title="比赛记录" description="支持编辑复盘；后续可继续加筛选 tag、topic、tournament 和 judge。" action={<Link className="link-button" href="/app/library">参考素材库中的优秀比赛录像 →</Link>}>
          <div className="timeline">
            {rawMatches.map((match) => (
              <article className="timeline-item" key={match.id}>
                <strong>{match.tournament} vs {match.opponent}</strong>
                <p>{match.topic} · {match.format} · {match.side} · {match.result}</p>
                <form action={saveReflection} className="form-grid compact">
                  <input type="hidden" name="matchId" value={match.id} />
                  <label className="field"><span>What worked</span><textarea name="whatWorked" defaultValue={match.reflection?.whatWorked ?? ""} rows={2} /></label>
                  <label className="field"><span>What failed</span><textarea name="whatFailed" defaultValue={match.reflection?.whatFailed ?? ""} rows={2} /></label>
                  <label className="field"><span>Judge feedback</span><textarea name="judgeFeedback" defaultValue={match.reflection?.judgeFeedback ?? ""} rows={2} /></label>
                  <label className="field"><span>Next steps</span><textarea name="nextSteps" defaultValue={match.reflection?.nextSteps ?? ""} rows={2} /></label>
                  <button className="button" type="submit">保存复盘</button>
                </form>
              </article>
            ))}
            {rawMatches.length === 0 ? <p className="empty-state">还没有比赛记录。</p> : null}
          </div>
        </SectionCard>

        <SectionCard title="统计图表区域" description="真实图表库后续接入；当前先展示聚合数据和可视化占位。">
          <ChartPlaceholder title="Argument win/loss count" description={`${stats.argumentOutcomeCount} 条 structured argument outcomes 可用于图表。`} />
          <div className="timeline spaced">
            {matches.flatMap((match) => match.argumentOutcomes.map((outcome, index) => ({ match, outcome, index }))).map(({ match, outcome, index }) => (
              <div className="timeline-item" key={outcome.id ?? `${match.id}-${index}`}>
                <strong>{outcome.argument}</strong>
                <p>{match.tournament} · {outcome.side} · {outcome.outcome}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
