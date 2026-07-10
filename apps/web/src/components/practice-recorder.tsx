"use client";

import { useState } from "react";

/**
 * 语音训练占位（阶段 5 后续）。
 * TODO: 接入 MediaRecorder 录音 → Whisper 转录 → 语速/filler/清晰度反馈，
 * 复用 @debate/ai/practice 的 SpeechAnalysisInput/Shape 与 feedback/rubric 管线。
 * 目前仅渲染禁用占位，不做任何录音/网络行为。
 */
export function PracticeRecorder() {
  const [open, setOpen] = useState(false);

  return (
    <div className="practice-recorder">
      <button
        className="button ghost"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "隐藏语音训练" : "语音训练（即将推出）▾"}
      </button>
      {open ? (
        <div className="practice-recorder-body">
          <p className="empty-state">
            语音训练即将推出：录音 → 自动转录 → 语速、填充词（filler words）、清晰度反馈。
            <br />
            Speech recording (coming soon): record → transcribe → pacing, filler words, and clarity feedback.
          </p>
          <button className="button" type="button" disabled aria-disabled="true">
            🎙 开始录音（即将推出）
          </button>
        </div>
      ) : null}
    </div>
  );
}
