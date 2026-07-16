import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { formatOptions } from "@debate/shared";
import { AIDraftPanel } from "@/components/ai-draft-panel";
import { EvidenceLibraryPanel } from "@/components/evidence-library-panel";
import { FlowSheet } from "@/components/flow-sheet";
import { SectionCard } from "@/components/section-card";
import { MatchRoomRealtime } from "@/components/match-room-realtime";
import { SharedSpeechNotes } from "@/components/shared-speech-notes";
import { createMatch, joinMatchRoom } from "./actions";
import { changeMatchRoomMember, rotateMatchRoomCode, transferMatchRoomOwner } from "./room-actions";
import { createFlowRow } from "./flow-actions";
import {
  getEvidenceForWorkspace,
  getFlowForMatch,
  getMatchById,
  getMatchEvidenceIds
} from "@/lib/data";
import { requireUser } from "@/lib/auth";
import { mapPrismaSide, mapPrismaFormat } from "@/lib/mappers";
import { sessionShellUser } from "@/lib/session-props";
import { getRoomDetails, listRoomsForUser } from "@/lib/rooms";

export default async function MatchesPage({
  searchParams
}: {
  searchParams: Promise<{ match?: string }>;
}) {
  const session = await requireUser();
  const { match: requestedId } = await searchParams;

  // 只有传入了有效且属于本 workspace 的比赛 id 时，才进入聚焦比赛室。
  const selectedMatch = requestedId
    ? await getMatchById(requestedId.trim(), session.user.id)
    : null;

  // ----- 比赛室状态：只显示这一场比赛的计时器 / 笔记 / AI / Flow。 -----
  if (selectedMatch) {
    const [evidence, flow, linkedEvidenceIds, room] = await Promise.all([
      getEvidenceForWorkspace(session.workspace.id, session.user.id),
      getFlowForMatch(selectedMatch.id, session.user.id),
      getMatchEvidenceIds(selectedMatch.id, session.user.id),
      getRoomDetails(selectedMatch.id, session.user.id, session.user.isSystemAdmin)
    ]);
    const side = mapPrismaSide(selectedMatch.side);
    const onlineMemberIds = new Set(room.presences.map((presence) => presence.userId));

    return (
      <AppShell
        activeHref="/app/matches"
        user={sessionShellUser(session)}
        note="比赛室：计时器、speech notes、AI 草稿、证据关联和 Live Flow 都绑定这一场比赛。"
      >
        <div className="practice-back-row">
          <Link className="button ghost" href="/app/matches">← 返回比赛列表</Link>
        </div>

        <section className="hero">
          <div className="eyebrow">Match Room</div>
          <h1>{selectedMatch.tournament} vs {selectedMatch.opponent}</h1>
          <p>{selectedMatch.topic}</p>
        </section>

        <SectionCard title="比赛房间" description="成员、比赛内容与计时器在局域网内准实时同步。">
          <MatchRoomRealtime matchId={selectedMatch.id} initialRevision={room.revision} />
          {room.ownerId === session.user.id || session.user.isSystemAdmin ? (
            <div className="room-management">
              <div className="actions">
                <span className="pill">房主：{room.owner.name}</span>
                <form action={rotateMatchRoomCode}>
                  <input type="hidden" name="matchId" value={selectedMatch.id} />
                  <button className="button" type="submit">更换邀请码</button>
                </form>
              </div>
              <div className="table-like">
                {room.members.map((member) => (
                  <div className="table-row" key={member.id}>
                    <div><strong>{member.user.name}</strong><br /><small>{member.user.email}</small></div>
                    <div><span className="pill">{member.status === "ACTIVE" ? "可访问" : "已移出"}</span></div>
                    <div className="actions">
                      {member.userId !== room.ownerId ? (
                        <form action={changeMatchRoomMember}>
                          <input type="hidden" name="matchId" value={selectedMatch.id} />
                          <input type="hidden" name="userId" value={member.userId} />
                          <input type="hidden" name="status" value={member.status === "ACTIVE" ? "REMOVED" : "ACTIVE"} />
                          <button className="button" type="submit">{member.status === "ACTIVE" ? "移出" : "恢复"}</button>
                        </form>
                      ) : null}
                      {member.status === "ACTIVE" && member.userId !== room.ownerId && onlineMemberIds.has(member.userId) ? (
                        <form action={transferMatchRoomOwner}>
                          <input type="hidden" name="matchId" value={selectedMatch.id} />
                          <input type="hidden" name="userId" value={member.userId} />
                          <button className="button" type="submit">转让房主</button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </SectionCard>

        <div style={{ height: 18 }} />

        <div className="grid two">
          <SectionCard title="比赛笔记" description={`${selectedMatch.tournament} vs ${selectedMatch.opponent}`}>
            <SharedSpeechNotes notes={selectedMatch.speechNotes} />
            {selectedMatch.notes.length ? (
              <div className="timeline spaced">
                {selectedMatch.notes.map((note) => (
                  <article className="timeline-item" key={note.id}>
                    <strong>{note.templateType}</strong>
                    <pre className="mini-pre">{JSON.stringify(note.contentJson, null, 2)}</pre>
                  </article>
                ))}
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="AI draft queue" description="生成前必须勾选同意发送所选 evidence；返回后仍需确认保存。">
            <AIDraftPanel matchId={selectedMatch.id} side={side} evidence={evidence} />
          </SectionCard>
        </div>

        <div style={{ height: 18 }} />

        <SectionCard
          title="Evidence 库 → 加入比赛"
          description="搜索资料库并一键把 evidence 关联到本场比赛；加入后可撤回或移出。"
        >
          <EvidenceLibraryPanel evidence={evidence} matchId={selectedMatch.id} linkedIds={linkedEvidenceIds} />
        </SectionCard>

        <div style={{ height: 18 }} />

        <SectionCard
          title="Live Flow"
          description="列＝发言顺序，行＝论点线。实时记录对方论点，按格调用 AI 从你的证据库匹配反驳草稿。"
        >
          <form action={createFlowRow} className="form-grid two-columns flow-add-row">
            <input type="hidden" name="matchId" value={selectedMatch.id} />
            <label className="field"><span>论点标签</span><input name="title" placeholder="例如：Fiscal costs" /></label>
            <label className="field">
              <span>立场</span>
              <select name="side" defaultValue={side}><option>Aff</option><option>Neg</option><option>Pro</option><option>Con</option><option>Generic</option></select>
            </label>
            <button className="button primary" type="submit">新增论点行</button>
          </form>
          <FlowSheet matchId={selectedMatch.id} columns={flow.columns} rows={flow.rows} evidence={evidence} />
        </SectionCard>
      </AppShell>
    );
  }

  // ----- 列表状态：创建比赛，或选择一场已有比赛进入比赛室。 -----
  const rooms = await listRoomsForUser(session.user.id);

  return (
    <AppShell
      activeHref="/app/matches"
      user={sessionShellUser(session)}
      note="先创建比赛，再进入比赛室。历史比赛可随时打开继续记录 flow。"
    >
      <section className="hero">
        <div className="eyebrow">Match Room</div>
        <h1>比赛页面</h1>
        <p>
          创建比赛后会直接进入比赛室。AI 只生成草稿，用户确认后才会保存。Evidence 按当前账号和 workspace 权限过滤，API key 只在服务器端读取。
        </p>
      </section>

      <SectionCard title="创建比赛" description="提交后会自动生成当前赛制的 speech rows，并进入比赛室。">
        <form action={createMatch} className="form-grid">
          <div className="form-grid two-columns">
            <label className="field"><span>Tournament</span><input name="tournament" defaultValue="Practice Round" required /></label>
            <label className="field"><span>Opponent</span><input name="opponent" placeholder="Opponent team" required /></label>
          </div>
          <label className="field"><span>Topic</span><input name="topic" defaultValue="Immigration and labor markets" required /></label>
          <div className="form-grid two-columns">
            <label className="field">
              <span>Format</span>
              <select name="format" defaultValue="PF">{formatOptions.map((option) => (<option key={option.id} value={option.id}>{option.id}</option>))}</select>
            </label>
            <label className="field">
              <span>Side</span>
              <select name="side" defaultValue="Aff"><option>Aff</option><option>Neg</option><option>Pro</option><option>Con</option><option>Generic</option></select>
            </label>
          </div>
          <div className="form-grid two-columns">
            <label className="field"><span>Round number</span><input name="roundNumber" placeholder="R1" /></label>
            <label className="field"><span>Judge</span><input name="judge" placeholder="Judge name" /></label>
          </div>
          <div className="form-grid two-columns">
            <label className="field"><span>Date</span><input name="date" type="date" /></label>
            <label className="field"><span>Tags</span><input name="tags" placeholder="economy, weighing" /></label>
          </div>
          <button className="button primary" type="submit">创建比赛 →</button>
        </form>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="加入比赛房间" description="输入房主分享的 6 位局域网邀请码。">
        <form action={joinMatchRoom} className="actions">
          <label className="field"><span>邀请码</span><input name="inviteCode" minLength={6} maxLength={6} required placeholder="ABC234" /></label>
          <button className="button primary" type="submit">加入房间</button>
        </form>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="比赛列表" description="点「进入比赛室」继续记录笔记、AI 草稿和 Live Flow。">
        <div className="timeline spaced">
          {rooms.map((room) => (
            <article className="timeline-item" key={room.id}>
              <div className="actions">
                <strong>{room.match.tournament} vs {room.match.opponent}</strong>
                <span className="pill">{mapPrismaFormat(room.match.format)}</span>
                <span className="pill">房主：{room.owner.name}</span>
              </div>
              <p>{room.match.topic}</p>
              <div className="actions">
                <Link className="button primary" href={`/app/matches?match=${room.match.id}`}>进入比赛房间</Link>
                <span className="pill">邀请码 {room.inviteCode}</span>
              </div>
            </article>
          ))}
          {rooms.length === 0 ? <p className="empty-state">还没有可访问的比赛房间。</p> : null}
        </div>
      </SectionCard>
    </AppShell>
  );
}
