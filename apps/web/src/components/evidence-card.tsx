import { validateEvidence, type Evidence } from "@debate/shared";

interface EvidenceCardProps {
  evidence: Evidence;
  /** 显示引用校验徽章（缺 source / date、quote 过长、URL 无效等）。 */
  showIssues?: boolean;
}

function safeExternalUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function EvidenceCard({ evidence, showIssues = false }: EvidenceCardProps) {
  const sourceUrl = safeExternalUrl(evidence.sourceUrl);
  const sourceLabel = evidence.publication ?? evidence.author ?? "Unlisted source";
  const issues = showIssues ? validateEvidence(evidence) : [];

  return (
    <article className="evidence-card" tabIndex={0}>
      <div className="evidence-meta">
        <span className={`pill side-pill side-${evidence.side.toLowerCase()}`}>{evidence.side}</span>
        {evidence.tags.map((tag) => (
          <span key={tag} className="pill">#{tag}</span>
        ))}
        {issues.map((issue) => (
          <span key={issue.code} className={`issue-badge ${issue.level}`} title={issue.message}>{issue.code}</span>
        ))}
      </div>
      <h3>{evidence.title}</h3>
      <p className="evidence-claim">{evidence.claim}</p>
      <blockquote className="evidence-quote">{evidence.quote}</blockquote>
      <div className="evidence-source">
        <span className="evidence-source-main">{sourceLabel}</span>
        <span className="evidence-source-date">{evidence.publishedDate ?? "No date"}</span>
      </div>
      <div className="reference-popover" role="note" aria-label={`Reference for ${evidence.title}`}>
        <strong>{evidence.author ?? "Unknown author"}</strong>
        <p>{evidence.publication ?? "Unlisted publication"} · {evidence.publishedDate ?? "No date"}</p>
        {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">Open source link →</a> : <span className="small-note">No source link</span>}
      </div>
    </article>
  );
}
