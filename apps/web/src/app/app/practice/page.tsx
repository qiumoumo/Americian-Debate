import Link from "next/link";
import { aiPersonas, aiPersonaLabels, formatOptions, getPracticeRoundState, isPracticeMode, practiceModes, practiceModeLabels } from "@debate/shared";
import { AppShell } from "@/components/app-shell";
import { PracticeRoom } from "@/components/practice-room";
import { PracticeHistory } from "@/components/practice-history";
import { SectionCard } from "@/components/section-card";
import { StatCard } from "@/components/stat-card";
import { createPracticeSession } from "./actions";
import { getPracticeSession, getPracticeSummaries, readDrills, readTranscript } from "@/lib/data";
import { requireUser } from "@/lib/auth";
import { mapPrismaFormat, mapPrismaSide } from "@/lib/mappers";
import { sessionShellUser } from "@/lib/session-props";

export default async function PracticePage({
  searchParams
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const session = await requireUser();
  const { session: requestedId } = await searchParams;

  // A session is "active" only when a valid, owned id is passed in the URL.
  const activePractice = requestedId
    ? await getPracticeSession(requestedId.trim(), session.user.id, session.workspace.id)
    : null;

  // ----- Training state: setup is done, show only the simplified room. -----
  if (activePractice) {
    const format = mapPrismaFormat(activePractice.format);
    const side = mapPrismaSide(activePractice.side);
    const transcript = readTranscript(activePractice.transcriptJson);
    const mode = isPracticeMode(activePractice.mode) ? activePractice.mode : "text-spar";
    const userTurns = transcript.filter((turn) => turn.role === "user").length;
    const roundState = getPracticeRoundState({ format, side, userTurns, mode });

    return (
      <AppShell
        activeHref="/app/practice"
        user={sessionShellUser(session)}
        note="训练界面：对话历史自动保存并智能压缩上下文，AI 对手可翻看早期发言。"
      >
        <div className="practice-page-active">
          <div className="practice-back-row">
            <Link className="button ghost" href="/app/practice">← 返回训练列表</Link>
          </div>

          <PracticeRoom
            sessionId={activePractice.id}
            transcript={transcript}
            topic={activePractice.topic}
            format={format}
            side={side}
            mode={activePractice.mode}
            persona={activePractice.persona}
            phaseLabel={roundState.phaseLabel}
            initialDrills={readDrills(activePractice.drillsJson)}
          />
        </div>
      </AppShell>
    );
  }

  // ----- List state: no active session, gate entry behind setup + history. -----
  const practiceSummaries = await getPracticeSummaries(session.user.id, session.workspace.id);
  const averageScore = practiceSummaries.length
    ? Math.round(practiceSummaries.reduce((sum, item) => sum + item.score, 0) / practiceSummaries.length)
    : 0;

  return (
    <AppShell
      activeHref="/app/practice"
      user={sessionShellUser(session)}
      note="先设置好训练，再进入训练界面。历史训练可继续练习或删除。"
    >
      <section className="hero">
        <div className="eyebrow">Practice Debate</div>
        <h1>训练场</h1>
        <p>
          设置好题目、赛制、立场和模式后开始训练。训练界面保存完整对话历史并智能压缩上下文，
          你也可以随时回到之前的训练继续练习。
        </p>
      </section>

      <div className="grid three">
        <StatCard label="平均分 Average" value={`${averageScore}`} note="近期训练平均分" />
        <StatCard label="场次 Sessions" value={`${practiceSummaries.length}`} note="当前账号记录数" />
        <StatCard label="状态 Status" value="待开始" note="创建训练后进入训练界面" />
      </div>

      <div style={{ height: 18 }} />

      <SectionCard title="创建训练 Create practice" description="设置好后将直接进入训练界面。会保存题目、赛制、立场、模式和 rubric focus。">
        <form action={createPracticeSession} className="form-grid">
          <label className="field">
            <span>题目 Topic</span>
            <input name="topic" defaultValue="AI safety regulation" required />
          </label>
          <div className="form-grid two-columns">
            <label className="field">
              <span>赛制 Format</span>
              <select name="format" defaultValue="LD">
                {formatOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.id}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>立场 Side</span>
              <select name="side" defaultValue="Neg">
                <option>Aff</option>
                <option>Neg</option>
                <option>Pro</option>
                <option>Con</option>
                <option>Generic</option>
              </select>
            </label>
          </div>
          <div className="form-grid two-columns">
            <label className="field">
              <span>模式 Mode</span>
              <select name="mode" defaultValue="text-spar">
                {practiceModes.map((id) => (
                  <option key={id} value={id}>
                    {practiceModeLabels[id].zh} · {practiceModeLabels[id].en}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>对手人格 Persona</span>
              <select name="persona" defaultValue="technical-opponent">
                {aiPersonas.map((id) => (
                  <option key={id} value={id}>
                    {aiPersonaLabels[id].zh} · {aiPersonaLabels[id].en}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Rubric focus</span>
            <input name="rubricFocus" defaultValue="clash, evidence extension, weighing, strategic collapse" />
          </label>
          <button className="button primary" type="submit">开始训练 →</button>
        </form>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="历史训练 Practice history" description="选择之前的训练继续练习，或删除不需要的记录。记录本地存储在 SQLite 中。">
        <PracticeHistory sessions={practiceSummaries} />
      </SectionCard>
    </AppShell>
  );
}
