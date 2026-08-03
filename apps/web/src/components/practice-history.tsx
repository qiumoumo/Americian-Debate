"use client";

import Link from "next/link";
import type { PracticeSessionSummary } from "@debate/shared";
import { deletePracticeSession } from "@/app/app/practice/actions";
import { useLanguage } from "@/components/language-provider";
import { dateLocaleForMode } from "@/lib/language-core";

interface PracticeHistoryProps {
  sessions: PracticeSessionSummary[];
}

function formatDate(iso: string, locale: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function PracticeHistory({ sessions }: PracticeHistoryProps) {
  const { activeMode } = useLanguage();
  const locale = dateLocaleForMode(activeMode);
  if (!sessions.length) {
    return <p className="empty-state">还没有训练记录。先在上方创建一个训练。</p>;
  }

  return (
    <div className="practice-history">
      {sessions.map((item) => (
        <article className="practice-history-item" key={item.id}>
          <div className="practice-history-main">
            <strong data-language-raw>{item.topic}</strong>
            <p className="practice-history-meta">
              {item.format} · {item.side} · {item.mode} · {item.turns} 轮发言
              {item.score ? ` · 分数 ${item.score}` : ""}
            </p>
            {formatDate(item.createdAt, locale) ? (
              <p className="practice-history-date">{formatDate(item.createdAt, locale)}</p>
            ) : null}
          </div>
          <div className="practice-history-actions">
            <Link className="button primary" href={`/app/practice?session=${item.id}`}>
              继续训练
            </Link>
            <form action={deletePracticeSession}>
              <input type="hidden" name="sessionId" value={item.id} />
              <button className="button danger" type="submit">删除</button>
            </form>
          </div>
        </article>
      ))}
    </div>
  );
}
