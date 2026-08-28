"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { formatOptions, suggestedRoundTags, type LibraryRoundRecord } from "@debate/shared";
import { createRound, updateRound, type LibraryActionResult } from "@/app/app/library/actions";

export function LibraryModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", closeOnEscape); document.body.style.overflow = previousOverflow; };
  }, [onClose]);

  return (
    <div className="document-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="document-modal library-modal" role="dialog" aria-modal="true" aria-labelledby="library-modal-title">
        <header className="document-modal-head">
          <h2 id="library-modal-title">{title}</h2>
          <button className="link-button" type="button" onClick={onClose} aria-label="关闭">关闭</button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function LibraryRoundForm({ round, onDone, onCancel }: {
  round?: LibraryRoundRecord;
  onDone: (result: LibraryActionResult) => void;
  onCancel: () => void;
}) {
  const titleInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LibraryActionResult>({ ok: false, message: "" });

  useEffect(() => { titleInput.current?.focus(); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const next = round ? await updateRound(formData) : await createRound(formData);
      setResult(next);
      if (next.ok) onDone(next);
    });
  }

  return (
    <form className="form-grid library-round-form" onSubmit={submit}>
      {round ? <input type="hidden" name="roundId" value={round.id} /> : null}
      <label className="field"><span>标题</span><input ref={titleInput} name="title" required defaultValue={round?.title} placeholder="2024 TOC PF Final" /></label>
      <label className="field"><span>视频链接</span><input name="videoUrl" type="url" required defaultValue={round?.videoUrl} placeholder="https://www.youtube.com/watch?v=..." /></label>
      <div className="grid two">
        <label className="field"><span>题目 / 辩题</span><input name="topic" defaultValue={round?.topic} placeholder="US–China trade" /></label>
        <label className="field"><span>队伍</span><input name="teams" defaultValue={round?.teams} placeholder="Team A vs Team B" /></label>
      </div>
      <div className="grid two">
        <label className="field"><span>赛事</span><input name="tournament" defaultValue={round?.tournament} placeholder="TOC" /></label>
        <label className="field"><span>年份</span><input name="year" defaultValue={round?.year} placeholder="2024" /></label>
      </div>
      <label className="field"><span>赛制</span><select name="format" defaultValue={round?.format ?? "PF"}>{formatOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      <label className="field"><span>标签</span><input name="tags" list="round-tag-suggestions" defaultValue={round?.tags.join(", ")} placeholder="PF, weighing, final focus" /></label>
      <label className="field"><span>备注</span><textarea name="description" rows={3} defaultValue={round?.description} placeholder="为什么值得看" /></label>
      {result.message && !result.ok ? <p className="status-error" role="alert">{result.message}</p> : null}
      <div className="document-modal-actions">
        <button className="button" type="button" onClick={onCancel} disabled={pending}>取消</button>
        <button className="button primary" type="submit" disabled={pending}>{pending ? "保存中..." : round ? "保存修改" : "保存并查看"}</button>
      </div>
    </form>
  );
}

export function LibraryRoundCreateModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  return (
    <LibraryModal title="新增比赛素材" onClose={onClose}>
      <LibraryRoundForm onCancel={onClose} onDone={(result) => {
        if (result.ok && result.roundId) router.push(`/app/library/${encodeURIComponent(result.roundId)}`);
      }} />
    </LibraryModal>
  );
}

export function RoundTagSuggestions() {
  return <datalist id="round-tag-suggestions">{suggestedRoundTags.map((tag) => <option key={tag} value={tag} />)}</datalist>;
}
