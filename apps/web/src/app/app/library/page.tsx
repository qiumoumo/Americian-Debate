import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { SectionCard } from "@/components/section-card";
import { formatOptions, suggestedRoundTags } from "@debate/shared";
import { addNote, createRound, deleteNote, deleteRound, updateRound } from "./actions";
import { getLibraryRoundById, getLibraryRoundsForWorkspace } from "@/lib/data";
import { requireUser } from "@/lib/auth";
import { formatTimestamp, resolveVideoEmbed } from "@/lib/mappers";
import { sessionShellUser } from "@/lib/session-props";

export default async function LibraryPage({
  searchParams
}: {
  searchParams: Promise<{ round?: string }>;
}) {
  const session = await requireUser();
  const { round: requestedId } = await searchParams;
  const rounds = await getLibraryRoundsForWorkspace(session.workspace.id, session.user.id);
  const selected = requestedId
    ? await getLibraryRoundById(requestedId.trim(), session.workspace.id, session.user.id)
    : null;

  return (
    <AppShell
      activeHref="/app/library"
      user={sessionShellUser(session)}
      note="收藏外部优秀比赛录像，做 timestamped flow 笔记。录像团队共享，笔记每人私有。"
    >
      <section className="hero">
        <div className="eyebrow">Round Library</div>
        <h1>素材库</h1>
        <p>
          保存优秀比赛的视频、题目、赛制、队伍与年份，边看边做带时间戳的 flow 笔记。借鉴 debatevid.io 的资料组织方式。
        </p>
      </section>

      <datalist id="round-tag-suggestions">
        {suggestedRoundTags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>

      <div className="grid two">
        <div>
          <SectionCard title="新增录像" description="粘贴 YouTube / Vimeo 链接或任意视频 URL；标签用逗号分隔。">
            <form action={createRound} className="form-grid compact">
              <label className="field"><span>标题</span><input name="title" required placeholder="2024 TOC PF Final" /></label>
              <label className="field"><span>视频链接</span><input name="videoUrl" required placeholder="https://www.youtube.com/watch?v=..." /></label>
              <label className="field"><span>题目 / 辩题</span><input name="topic" placeholder="US–China trade" /></label>
              <label className="field"><span>队伍</span><input name="teams" placeholder="Team A vs Team B" /></label>
              <div className="grid two">
                <label className="field"><span>赛事</span><input name="tournament" placeholder="TOC" /></label>
                <label className="field"><span>年份</span><input name="year" placeholder="2024" /></label>
              </div>
              <label className="field">
                <span>赛制</span>
                <select name="format" defaultValue="PF">
                  {formatOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              </label>
              <label className="field"><span>标签</span><input name="tags" list="round-tag-suggestions" placeholder="PF, weighing, final focus" /></label>
              <label className="field"><span>备注</span><textarea name="description" rows={2} placeholder="为什么值得看" /></label>
              <button className="button" type="submit">保存录像</button>
            </form>
          </SectionCard>

          <div style={{ height: 18 }} />

          <SectionCard title="录像列表" description="点击进入某场录像，查看内嵌视频并做笔记。">
            <div className="timeline">
              {rounds.map((round) => (
                <Link
                  key={round.id}
                  href={`/app/library?round=${round.id}`}
                  className="timeline-item"
                  data-active={selected?.id === round.id}
                >
                  <strong>{round.title}</strong>
                  <p>
                    {[round.teams, round.topic].filter(Boolean).join(" · ") || "未填题目"}
                  </p>
                  <p>
                    {round.format}
                    {round.tournament ? ` · ${round.tournament}` : ""}
                    {round.year ? ` · ${round.year}` : ""}
                    {round.notes.length ? ` · ${round.notes.length} 条笔记` : ""}
                  </p>
                  {round.tags.length ? (
                    <div className="evidence-meta">
                      {round.tags.map((tag) => (
                        <span key={tag} className="pill">{tag}</span>
                      ))}
                    </div>
                  ) : null}
                </Link>
              ))}
              {rounds.length === 0 ? <p className="empty-state">还没有录像，先从左侧添加一场。</p> : null}
            </div>
          </SectionCard>
        </div>

        <div>
          {selected ? (
            <SelectedRound round={selected} />
          ) : (
            <SectionCard title="录像详情" description="从左侧选择一场录像。">
              <p className="empty-state">选择一场录像后，这里显示内嵌视频、元信息，以及你私有的 flow 笔记。</p>
            </SectionCard>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function SelectedRound({
  round
}: {
  round: NonNullable<Awaited<ReturnType<typeof getLibraryRoundById>>>;
}) {
  const embed = resolveVideoEmbed(round.videoUrl);

  return (
    <>
      <SectionCard
        title={round.title}
        description={[round.teams, round.topic].filter(Boolean).join(" · ") || undefined}
      >
        {embed.embedUrl ? (
          <div className="video-frame">
            <iframe
              src={embed.embedUrl}
              title={round.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : (
          <p>
            <a href={round.videoUrl} target="_blank" rel="noopener noreferrer nofollow">在新标签页打开视频 ↗</a>
          </p>
        )}

        <p>
          {round.format}
          {round.tournament ? ` · ${round.tournament}` : ""}
          {round.year ? ` · ${round.year}` : ""}
        </p>
        {round.description ? <p>{round.description}</p> : null}
        {round.tags.length ? (
          <div className="evidence-meta">
            {round.tags.map((tag) => (
              <span key={tag} className="pill">{tag}</span>
            ))}
          </div>
        ) : null}
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="我的 flow 笔记" description="仅自己可见。时间戳可选，格式如 1:30 或 1:02:03。">
        <form action={addNote} className="form-grid compact">
          <input type="hidden" name="roundId" value={round.id} />
          <div className="grid two">
            <label className="field"><span>时间戳（可选）</span><input name="timestamp" placeholder="1:30" /></label>
          </div>
          <label className="field"><span>笔记</span><textarea name="body" rows={2} required placeholder="Aff 在 summary 掉了 framework..." /></label>
          <button className="button" type="submit">添加笔记</button>
        </form>

        <div className="timeline spaced">
          {round.notes.map((note) => (
            <div className="timeline-item" key={note.id}>
              {note.timestampSeconds != null ? <span className="pill">{formatTimestamp(note.timestampSeconds)}</span> : null}
              <p>{note.body}</p>
              <form action={deleteNote}>
                <input type="hidden" name="noteId" value={note.id} />
                <button className="button ghost" type="submit">删除</button>
              </form>
            </div>
          ))}
          {round.notes.length === 0 ? <p className="empty-state">还没有笔记。</p> : null}
        </div>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="编辑 / 删除录像" description="录像团队共享，改动对所有成员可见。">
        <form action={updateRound} className="form-grid compact">
          <input type="hidden" name="roundId" value={round.id} />
          <label className="field"><span>标题</span><input name="title" required defaultValue={round.title} /></label>
          <label className="field"><span>视频链接</span><input name="videoUrl" required defaultValue={round.videoUrl} /></label>
          <label className="field"><span>题目 / 辩题</span><input name="topic" defaultValue={round.topic} /></label>
          <label className="field"><span>队伍</span><input name="teams" defaultValue={round.teams} /></label>
          <div className="grid two">
            <label className="field"><span>赛事</span><input name="tournament" defaultValue={round.tournament} /></label>
            <label className="field"><span>年份</span><input name="year" defaultValue={round.year} /></label>
          </div>
          <label className="field">
            <span>赛制</span>
            <select name="format" defaultValue={round.format}>
              {formatOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </label>
          <label className="field"><span>标签</span><input name="tags" list="round-tag-suggestions" defaultValue={round.tags.join(", ")} /></label>
          <label className="field"><span>备注</span><textarea name="description" rows={2} defaultValue={round.description} /></label>
          <button className="button" type="submit">保存修改</button>
        </form>

        <form action={deleteRound} className="form-grid compact">
          <input type="hidden" name="roundId" value={round.id} />
          <button className="button ghost" type="submit">删除录像</button>
        </form>
      </SectionCard>
    </>
  );
}
