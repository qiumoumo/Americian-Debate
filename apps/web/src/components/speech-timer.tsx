"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebateFormat, Side } from "@debate/shared";
import { debateFormats, formatConfigs, formatOptions } from "@debate/shared";

interface SpeechTimerProps {
  /** 当前比赛赛制，决定默认列出的 speech 列表与 prep 时长。 */
  format?: DebateFormat;
}

type TimerMode = "speech" | "prep";

function formatLabel(id: DebateFormat) {
  return formatConfigs[id]?.name ?? debateFormats.find((entry) => entry.id === id)?.name ?? id;
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString();
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** 从 config 的 prepBySide 建立各方 prep 剩余池的初始快照。 */
function initialPrepPools(format: DebateFormat): Partial<Record<Side, number>> {
  return { ...(formatConfigs[format]?.prepBySide ?? {}) };
}

export function SpeechTimer({ format: initialFormat = "PF" }: SpeechTimerProps) {
  const [format, setFormat] = useState<DebateFormat>(initialFormat);
  const config = useMemo(() => formatConfigs[format] ?? formatConfigs.PF, [format]);
  const speeches = config.speeches;
  const prepSides = useMemo(
    () => (Object.keys(config.prepBySide) as Side[]).filter((side) => (config.prepBySide[side] ?? 0) > 0),
    [config]
  );

  const [speechIndex, setSpeechIndex] = useState(0);
  const [mode, setMode] = useState<TimerMode>("speech");
  const [autoAdvance, setAutoAdvance] = useState(true);

  // 每方 prep 剩余（毫秒）；跨段扣减，切换赛制时重置。
  const [prepRemaining, setPrepRemaining] = useState<Partial<Record<Side, number>>>(() => initialPrepPools(format));
  const [prepSide, setPrepSide] = useState<Side>(prepSides[0] ?? "Generic");

  const currentSpeech = speeches[Math.min(speechIndex, speeches.length - 1)] ?? speeches[0];
  const isPrep = mode === "prep";
  const prepBudget = isPrep ? prepRemaining[prepSide] ?? 0 : 0;
  const baseDuration = isPrep ? prepBudget : currentSpeech.durationMs;

  const [remainingMs, setRemainingMs] = useState(baseDuration);
  const [running, setRunning] = useState(false);
  const remainingRef = useRef(remainingMs);
  remainingRef.current = remainingMs;

  // 切换赛制时回到第一段发言并重置 prep 池。
  useEffect(() => {
    setSpeechIndex(0);
    setMode("speech");
    setPrepRemaining(initialPrepPools(format));
    setPrepSide((Object.keys(formatConfigs[format]?.prepBySide ?? {}) as Side[])[0] ?? "Generic");
  }, [format]);

  // 切换发言/prep 时重置剩余时间并停表。
  useEffect(() => {
    setRemainingMs(baseDuration);
    setRunning(false);
  }, [baseDuration]);

  const advanceToNext = useCallback(() => {
    setSpeechIndex((index) => (index + 1 < speeches.length ? index + 1 : index));
  }, [speeches.length]);

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const startedAt = Date.now();
    const initialRemaining = remainingRef.current;
    const interval = window.setInterval(() => {
      const nextRemaining = Math.max(0, initialRemaining - (Date.now() - startedAt));
      setRemainingMs(nextRemaining);
      // prep 模式下实时把剩余写回该方的池，实现跨段扣减。
      if (mode === "prep") {
        setPrepRemaining((pools) => ({ ...pools, [prepSide]: nextRemaining }));
      }
      if (nextRemaining === 0) {
        setRunning(false);
        if (mode === "speech" && autoAdvance && speechIndex + 1 < speeches.length) {
          advanceToNext();
        }
      }
    }, 200);
    return () => window.clearInterval(interval);
  }, [running, mode, autoAdvance, speechIndex, speeches.length, advanceToNext, prepSide]);

  function enterSpeechMode(index: number) {
    // 离开 prep 时把当前剩余固化到该方池中（防止暂停态下未写回）。
    if (mode === "prep") {
      setPrepRemaining((pools) => ({ ...pools, [prepSide]: Math.max(0, remainingRef.current) }));
    }
    setMode("speech");
    setSpeechIndex(index);
  }

  function enterPrepMode(side: Side) {
    setPrepSide(side);
    setMode("prep");
  }

  const isCrossfire = !isPrep && currentSpeech.kind === "crossfire";
  const timerCritical = remainingMs > 0 && remainingMs <= 30000;

  return (
    <div className="timer-panel">
      <div className="timer-controls-row">
        <label className="field">
          <span>赛制 Format</span>
          <select value={format} onChange={(event) => setFormat(event.target.value as DebateFormat)}>
            {formatOptions.map((option) => (
              <option key={option.id} value={option.id}>{formatLabel(option.id)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>发言 Speech</span>
          <select
            value={isPrep ? "prep" : String(speechIndex)}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "prep") {
                enterPrepMode(prepSides[0] ?? "Generic");
              } else {
                enterSpeechMode(Number(value));
              }
            }}
          >
            {speeches.map((preset, index) => (
              <option key={`${preset.speech}-${index}`} value={index}>
                {index + 1}. {preset.speech}{preset.kind === "crossfire" ? " · CF" : ""} · {formatTime(preset.durationMs)}
              </option>
            ))}
            {prepSides.length ? <option value="prep">Prep time</option> : null}
          </select>
        </label>
      </div>

      <div
        className={`timer-face${isPrep ? " timer-face-prep" : ""}${isCrossfire ? " timer-face-crossfire" : ""}${timerCritical ? " timer-face-critical" : ""}`}
        aria-label={`Timer showing ${formatTime(remainingMs)}`}
      >
        <span className="timer-stage">
          {isPrep ? `Prep (${prepSide})` : currentSpeech.speech}
        </span>
        <strong>{formatTime(remainingMs)}</strong>
        <span className="timer-hint">
          {isPrep
            ? "准备时间"
            : isCrossfire
              ? "Q&A · 不计入 flow"
              : `第 ${speechIndex + 1} / ${speeches.length} 段`}
        </span>
      </div>

      <div className="actions timer-actions">
        <button className="button primary" type="button" onClick={() => setRunning((value) => !value)}>
          {running ? "暂停" : "开始"}
        </button>
        <button
          className="button"
          type="button"
          onClick={() => {
            setRunning(false);
            if (isPrep) {
              // 重置当前 prep 段回到该方的完整预算。
              const budget = config.prepBySide[prepSide] ?? 0;
              setPrepRemaining((pools) => ({ ...pools, [prepSide]: budget }));
              setRemainingMs(budget);
            } else {
              setRemainingMs(baseDuration);
            }
          }}
        >
          重置
        </button>
        <button
          className="button"
          type="button"
          disabled={isPrep ? false : speechIndex + 1 >= speeches.length}
          onClick={() => {
            if (isPrep) {
              enterSpeechMode(speechIndex);
            } else {
              enterSpeechMode(Math.min(speechIndex + 1, speeches.length - 1));
            }
          }}
        >
          下一段 →
        </button>
      </div>

      {prepSides.length ? (
        <div className="actions timer-prep-row">
          {prepSides.map((side) => {
            const remaining = prepRemaining[side] ?? 0;
            const activePrep = isPrep && prepSide === side;
            return (
              <button
                key={side}
                className={`button${activePrep ? " primary" : ""}`}
                type="button"
                disabled={remaining <= 0 && !activePrep}
                onClick={() => (activePrep ? enterSpeechMode(speechIndex) : enterPrepMode(side))}
              >
                {activePrep ? `回到发言 · ${side}` : `Prep ${side} · ${formatTime(remaining)} 剩余`}
              </button>
            );
          })}
        </div>
      ) : null}

      <label className="check-field timer-auto">
        <input type="checkbox" checked={autoAdvance} onChange={(event) => setAutoAdvance(event.target.checked)} />
        <span>计时归零后自动切到下一段 speech</span>
      </label>
    </div>
  );
}
