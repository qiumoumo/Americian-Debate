"use client";

import { useEffect, useRef, useState } from "react";

interface UndoToastProps {
  /** 提示文字，例如「已导入 3 张 evidence」。 */
  message: string;
  /** 撤回按钮文案。 */
  actionLabel?: string;
  /** 自动消失秒数。 */
  seconds?: number;
  /** 点击撤回时调用。 */
  onUndo: () => void;
  /** toast 关闭（撤回或超时）时调用。 */
  onDismiss: () => void;
}

/**
 * 可复用的撤回条：底部悬浮，带倒计时，点击「撤回」触发 onUndo。
 * 超时或手动关闭都会调用 onDismiss，由父组件卸载。
 */
export function UndoToast({ message, actionLabel = "撤回", seconds = 8, onUndo, onDismiss }: UndoToastProps) {
  const [remaining, setRemaining] = useState(seconds);
  // 用 ref 固定回调，避免 effect 依赖导致计时器重置。
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    setRemaining(seconds);
    const timer = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          clearInterval(timer);
          dismissRef.current();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds, message]);

  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span className="undo-toast-msg">{message}</span>
      <button
        type="button"
        className="undo-toast-action"
        onClick={() => {
          onUndo();
          onDismiss();
        }}
      >
        {actionLabel}
      </button>
      <span className="undo-toast-count" aria-hidden="true">{remaining}s</span>
      <button type="button" className="undo-toast-close" aria-label="关闭" onClick={onDismiss}>×</button>
    </div>
  );
}
