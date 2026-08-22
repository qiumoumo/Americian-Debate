import type { MatchHistoryView } from "@/lib/match-reports";

interface MatchOutcomeDistributionProps {
  outcomes: MatchHistoryView["stats"]["argumentOutcomes"];
}

const rows = [
  { key: "won", label: "赢下", tone: "won" },
  { key: "lost", label: "失守", tone: "lost" },
  { key: "dropped", label: "对方掉点", tone: "dropped" },
  { key: "turned", label: "完成转点", tone: "turned" },
  { key: "conceded", label: "我方让步", tone: "conceded" }
] as const;

export function MatchOutcomeDistribution({ outcomes }: MatchOutcomeDistributionProps) {
  return (
    <section className="outcome-distribution" aria-labelledby="outcome-distribution-title">
      <div className="section-title">
        <div>
          <h2 id="outcome-distribution-title">论点结果分布</h2>
          <p>{`${outcomes.total} 条已判定论点`}</p>
        </div>
      </div>
      {outcomes.total ? (
        <>
          <div className="outcome-bars" aria-hidden="true">
            {rows.map((row) => {
              const count = outcomes[row.key];
              const percent = Math.round((count / outcomes.total) * 100);
              return (
                <div className="outcome-bar-row" key={row.key}>
                  <div className="outcome-bar-label"><span>{row.label}</span><strong>{count}</strong></div>
                  <div className="outcome-bar-track"><div className={`outcome-bar-fill ${row.tone}`} style={{ width: `${percent}%` }} /></div>
                  <span className="outcome-bar-percent">{percent}%</span>
                </div>
              );
            })}
          </div>
          <div className="semantic-table-wrap">
            <table className="semantic-table">
              <caption>论点结果计数和占比</caption>
              <thead><tr><th scope="col">结果</th><th scope="col">数量</th><th scope="col">占比</th></tr></thead>
              <tbody>
                {rows.map((row) => {
                  const count = outcomes[row.key];
                  return <tr key={row.key}><th scope="row">{row.label}</th><td>{count}</td><td>{Math.round((count / outcomes.total) * 100)}%</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : <p className="empty-state">提交报告后，论点结果会显示在这里。</p>}
    </section>
  );
}
