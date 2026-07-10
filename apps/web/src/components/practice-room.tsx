"use client";

import { useEffect, useRef, useState } from "react";
import type { AiPersona, DebateFormat, PracticeMode } from "@debate/shared";
import { aiPersonaLabels, isAiPersona } from "@debate/shared";
import { SpeechTimer } from "@/components/speech-timer";
import { PracticeRecorder } from "@/components/practice-recorder";

interface PracticeDrill {
  title: string;
  instructions: string;
  targetDimension: string;
  durationSeconds: number;
  promptText: string;
}

interface PracticeRoomProps {
  sessionId?: string;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  topic?: string;
  format?: DebateFormat;
  side?: string;
  mode?: string;
  persona?: string;
  /** 服务端算好的当前 round 阶段标签（如 "LD · 1AR（你的第 2 次发言）"）。 */
  phaseLabel?: string;
  initialDrills?: PracticeDrill[];
}

interface RubricScore {
  score: number;
  comment: string;
}

interface PracticeFeedback {
  score: number;
  feedback: string;
  rubric?: Record<string, RubricScore>;
  strengths: string[];
  weaknesses: string[];
  nextDrills: string[];
}

/** 右侧栏一次只打开一个浮窗。 */
type Panel = "timer" | "feedback" | "drills" | "copy" | "recorder";

// 五维 rubric 的双语标签与固定顺序。
const RUBRIC_DIMENSIONS: Array<{ key: string; zh: string; en: string }> = [
  { key: "clash", zh: "交锋", en: "Clash" },
  { key: "evidenceExtension", zh: "证据延伸", en: "Evidence extension" },
  { key: "weighing", zh: "权衡", en: "Weighing" },
  { key: "collapse", zh: "收束", en: "Collapse" },
  { key: "lineByLineEfficiency", zh: "逐点效率", en: "Line-by-line" }
];

// 右侧功能栏按钮定义（图标 + 双语标签）。
const RAIL_ITEMS: Array<{ id: Panel; icon: string; label: string }> = [
  { id: "timer", icon: "⏱", label: "计时器" },
  { id: "feedback", icon: "🎯", label: "教练反馈" },
  { id: "drills", icon: "🏋", label: "训练任务" },
  { id: "copy", icon: "📋", label: "Copy prompt" },
  { id: "recorder", icon: "🎙", label: "语音训练" }
];

const PANEL_TITLES: Record<Panel, string> = {
  timer: "计时器 Timer",
  feedback: "教练反馈 Coach feedback",
  drills: "训练任务 Drills",
  copy: "Copy prompt",
  recorder: "语音训练 Speech drill"
};

function personaLabel(persona?: string) {
  if (persona && isAiPersona(persona)) {
    const label = aiPersonaLabels[persona as AiPersona];
    return `${label.zh} · ${label.en}`;
  }
  return "技术型对手 · Technical";
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as { error?: string };
  } catch {
    return { error: response.ok ? undefined : text.slice(0, 240) };
  }
}

export function PracticeRoom({
  sessionId,
  transcript: initialTranscript,
  topic,
  format,
  side,
  mode,
  persona,
  phaseLabel,
  initialDrills
}: PracticeRoomProps) {
  const [message, setMessage] = useState("");
  const [transcript, setTranscript] = useState(initialTranscript);
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null);
  const [drills, setDrills] = useState<PracticeDrill[]>(initialDrills ?? []);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [activePanel, setActivePanel] = useState<Panel | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const isCrossfire = mode === ("crossfire" satisfies PracticeMode);

  // 新消息到达后自动滚动到底部。
  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [transcript]);

  function togglePanel(panel: Panel) {
    setActivePanel((current) => (current === panel ? null : panel));
  }

  async function sendMessage() {
    if (!sessionId || !message.trim()) {
      return;
    }
    setError(null);
    setIsPending(true);

    try {
      const response = await fetch("/api/ai/practice/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        setError(payload.error ?? "Practice response failed");
        return;
      }
      setTranscript((payload as { transcript: PracticeRoomProps["transcript"] }).transcript);
      setMessage("");
    } catch {
      setError("Practice response failed. Please check your network or server logs.");
    } finally {
      setIsPending(false);
    }
  }

  async function generateFeedback() {
    if (!sessionId) {
      return;
    }
    setError(null);
    setIsPending(true);

    try {
      const response = await fetch("/api/ai/practice/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        setError(payload.error ?? "Practice scoring failed");
        return;
      }
      setFeedback((payload as { feedback: PracticeFeedback }).feedback);
      setActivePanel("feedback");
    } catch {
      setError("Practice scoring failed. Please check your network or server logs.");
    } finally {
      setIsPending(false);
    }
  }

  async function generateDrills() {
    if (!sessionId) {
      return;
    }
    setError(null);
    setIsPending(true);

    try {
      const response = await fetch("/api/ai/practice/drill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        setError(payload.error ?? "Drill generation failed");
        return;
      }
      setDrills((payload as { drills: PracticeDrill[] }).drills ?? []);
      setActivePanel("drills");
    } catch {
      setError("Drill generation failed. Please check your network or server logs.");
    } finally {
      setIsPending(false);
    }
  }

  async function copyPrompt(kind: "opponent" | "feedback" | "drill") {
    if (!sessionId) {
      return;
    }
    if (kind === "opponent" && !message.trim()) {
      setError("Write a speech first so the opponent prompt has something to answer.");
      return;
    }

    setError(null);
    setCopyStatus(null);

    const url =
      kind === "opponent"
        ? "/api/ai/practice/respond"
        : kind === "feedback"
          ? "/api/ai/practice/score"
          : "/api/ai/practice/drill";
    const body =
      kind === "opponent"
        ? { sessionId, message, copyPromptOnly: true }
        : { sessionId, copyPromptOnly: true };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await readJsonResponse(response)) as { error?: string; prompt?: string };
      if (!response.ok || !payload.prompt) {
        setError(payload.error ?? "Could not build prompt");
        return;
      }
      await navigator.clipboard.writeText(payload.prompt);
      setCopyStatus(
        kind === "opponent" ? "Opponent prompt copied." : kind === "feedback" ? "Coach feedback prompt copied." : "Drill prompt copied."
      );
    } catch {
      setError("Could not copy prompt. Please check browser clipboard permissions.");
    }
  }

  function applyDrill(drill: PracticeDrill) {
    setMessage(drill.promptText);
    setActivePanel(null);
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter 发送，Shift+Enter 换行（输入法组字时不触发）。
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  }

  const metaChips = [
    { label: "赛制 Format", value: format || "—" },
    { label: "立场 Side", value: side || "—" },
    { label: "模式 Mode", value: mode || "—" },
    { label: "对手人格 Persona", value: personaLabel(persona) },
    { label: "当前阶段 Stage", value: sessionId ? phaseLabel || "待开始" : "待开始" }
  ];

  return (
    <div className="chat-room">
      <header className="chat-room-header">
        <div className="chat-room-topic">
          <span className="chat-room-eyebrow">题目 Topic</span>
          <strong>{topic || "尚未创建训练"}</strong>
        </div>
        <div className="chat-room-chips">
          {metaChips.map((chip) => (
            <span className="chat-chip" key={chip.label}>
              <span className="chat-chip-label">{chip.label}</span>
              <span className="chat-chip-value">{chip.value}</span>
            </span>
          ))}
        </div>
      </header>

      <div className="chat-room-main">
        <div className="chat-scroll" ref={scrollRef}>
          {transcript.length ? (
            transcript.map((turn, index) => (
              <div className="chat-turn" data-role={turn.role} key={`${turn.role}-${index}`}>
                <strong>{turn.role === "user" ? "你 You" : "AI 对手 Opponent"}</strong>
                <p>{turn.content}</p>
              </div>
            ))
          ) : (
            <p className="empty-state chat-empty">
              {sessionId ? "在下方输入你的辩论发言，开始与 AI 对手交锋。" : "创建训练后即可开始对话。"}
            </p>
          )}
        </div>

        <nav className="chat-rail" aria-label="训练工具">
          {RAIL_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="chat-rail-button"
              aria-pressed={activePanel === item.id}
              title={item.label}
              onClick={() => togglePanel(item.id)}
            >
              <span className="chat-rail-icon" aria-hidden>{item.icon}</span>
              <span className="chat-rail-label">{item.label}</span>
            </button>
          ))}
        </nav>

        {activePanel ? (
          <aside className={`chat-popover chat-popover-${activePanel}`} role="dialog" aria-label={PANEL_TITLES[activePanel]}>
            <div className="chat-popover-head">
              <strong>{PANEL_TITLES[activePanel]}</strong>
              <button type="button" className="chat-popover-close" aria-label="关闭" onClick={() => setActivePanel(null)}>
                ×
              </button>
            </div>
            <div className="chat-popover-body">
              {activePanel === "timer" ? <SpeechTimer format={format ?? "PF"} /> : null}

              {activePanel === "copy" ? (
                <div className="chat-popover-actions">
                  <button className="button" type="button" disabled={!sessionId || isPending} onClick={() => copyPrompt("opponent")}>
                    Copy opponent prompt
                  </button>
                  <button className="button" type="button" disabled={!sessionId || isPending} onClick={() => copyPrompt("feedback")}>
                    Copy feedback prompt
                  </button>
                  <button className="button" type="button" disabled={!sessionId || isPending} onClick={() => copyPrompt("drill")}>
                    Copy drill prompt
                  </button>
                  {copyStatus ? <p className="success-text">{copyStatus}</p> : null}
                </div>
              ) : null}

              {activePanel === "recorder" ? <PracticeRecorder /> : null}

              {activePanel === "feedback" ? (
                feedback ? (
                  <div className="feedback-panel">
                    <div className="feedback-score">
                      <strong>{Math.round(feedback.score)}</strong>
                      <span>Coach score</span>
                    </div>
                    <p>{feedback.feedback}</p>
                    {feedback.rubric ? (
                      <div className="feedback-rubric">
                        <strong className="feedback-rubric-title">分维度评分 Rubric</strong>
                        <div className="feedback-rubric-grid">
                          {RUBRIC_DIMENSIONS.map((dimension) => {
                            const entry = feedback.rubric?.[dimension.key];
                            if (!entry) {
                              return null;
                            }
                            return (
                              <div className="feedback-rubric-row" key={dimension.key}>
                                <div className="feedback-rubric-label">
                                  <span>{dimension.zh}</span>
                                  <span className="feedback-rubric-en">{dimension.en}</span>
                                </div>
                                <div className="feedback-rubric-score">{Math.round(entry.score)}</div>
                                <p className="feedback-rubric-comment">{entry.comment}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    <div className="grid three">
                      <div>
                        <strong>Strengths</strong>
                        <ul>{feedback.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
                      </div>
                      <div>
                        <strong>Weaknesses</strong>
                        <ul>{feedback.weaknesses.map((item) => <li key={item}>{item}</li>)}</ul>
                      </div>
                      <div>
                        <strong>Next drills</strong>
                        <ul>{feedback.nextDrills.map((item) => <li key={item}>{item}</li>)}</ul>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="chat-popover-empty">
                    <p className="empty-state">还没有教练反馈。先进行几段发言，再点下方按钮生成。</p>
                    <button className="button primary" type="button" disabled={!sessionId || isPending} onClick={generateFeedback}>
                      {isPending ? "生成中..." : "生成教练反馈"}
                    </button>
                  </div>
                )
              ) : null}

              {activePanel === "drills" ? (
                <div className="chat-popover-drills">
                  {drills.length ? (
                    <div className="practice-drill-list">
                      {drills.map((drill, index) => (
                        <article className="practice-drill-card" key={`${drill.title}-${index}`}>
                          <div className="practice-drill-head">
                            <strong>{drill.title}</strong>
                            <span className="practice-drill-chip">{drill.targetDimension}</span>
                            <span className="practice-drill-chip">{drill.durationSeconds}s</span>
                          </div>
                          {drill.instructions ? <p className="practice-drill-instructions">{drill.instructions}</p> : null}
                          {drill.promptText ? <p className="practice-drill-prompt">{drill.promptText}</p> : null}
                          <button className="button" type="button" disabled={!drill.promptText} onClick={() => applyDrill(drill)}>
                            使用此训练 Use this drill
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state">还没有训练任务。</p>
                  )}
                  <button className="button primary" type="button" disabled={!sessionId || isPending} onClick={generateDrills}>
                    {isPending ? "生成中..." : "生成训练任务"}
                  </button>
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>

      <footer className="chat-composer">
        {error ? <p className="error-text chat-composer-note">{error}</p> : null}
        {copyStatus && activePanel !== "copy" ? <p className="success-text chat-composer-note">{copyStatus}</p> : null}
        <div className="chat-composer-row">
          <textarea
            className="chat-composer-input"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            rows={isCrossfire ? 2 : 3}
            placeholder={
              isCrossfire
                ? "输入一个质询问题或回答…（Enter 发送，Shift+Enter 换行）"
                : "输入你的下一段发言…（Enter 发送，Shift+Enter 换行）"
            }
          />
          <div className="chat-composer-buttons">
            <button className="button primary" type="button" disabled={!sessionId || isPending || !message.trim()} onClick={sendMessage}>
              {isPending ? "发送中..." : isCrossfire ? "发送提问/回答" : "发送给 AI 对手"}
            </button>
            <button className="button ghost" type="button" disabled={!sessionId || isPending} onClick={generateFeedback}>
              生成教练反馈
            </button>
            <button className="button ghost" type="button" disabled={!sessionId || isPending} onClick={generateDrills}>
              生成训练任务
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
