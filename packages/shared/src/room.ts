import { formatConfigs, type DebateFormat, type Side } from "./index.ts";

export const ROOM_INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type RandomBytes = (length: number) => Uint8Array;

export function createInviteCode(randomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length))) {
  const bytes = randomBytes(6);
  return Array.from(bytes, (value) => ROOM_INVITE_ALPHABET[value % ROOM_INVITE_ALPHABET.length]).join("");
}

export type SharedTimerMode = "speech" | "prep";

export interface SharedTimerState {
  format: DebateFormat;
  mode: SharedTimerMode;
  speechIndex: number;
  prepSide: Side;
  remainingMs: number;
  prepRemaining: Partial<Record<Side, number>>;
  running: boolean;
  autoAdvance: boolean;
}

export function createInitialSharedTimer(format: DebateFormat): SharedTimerState {
  const config = formatConfigs[format] ?? formatConfigs.PF;
  const prepSides = Object.keys(config.prepBySide) as Side[];
  return {
    format,
    mode: "speech",
    speechIndex: 0,
    prepSide: prepSides[0] ?? "Generic",
    remainingMs: config.speeches[0]?.durationMs ?? 0,
    prepRemaining: { ...config.prepBySide },
    running: false,
    autoAdvance: true
  };
}

export function normalizeSharedTimer(
  input: SharedTimerState,
  nowMs: number,
  startedAtMs: number | null
): { state: SharedTimerState; startedAtMs: number | null; changed: boolean } {
  if (!input.running || startedAtMs === null) {
    return { state: input, startedAtMs: input.running ? null : startedAtMs, changed: input.running && startedAtMs === null };
  }

  const elapsed = Math.max(0, nowMs - startedAtMs);
  const remainingMs = Math.max(0, input.remainingMs - elapsed);
  if (remainingMs > 0) {
    const prepRemaining = input.mode === "prep"
      ? { ...input.prepRemaining, [input.prepSide]: remainingMs }
      : input.prepRemaining;
    return {
      state: { ...input, remainingMs, prepRemaining },
      startedAtMs,
      changed: remainingMs !== input.remainingMs
    };
  }

  if (input.mode === "speech" && input.autoAdvance) {
    const config = formatConfigs[input.format] ?? formatConfigs.PF;
    const nextIndex = Math.min(input.speechIndex + 1, Math.max(0, config.speeches.length - 1));
    if (nextIndex !== input.speechIndex) {
      return {
        state: {
          ...input,
          speechIndex: nextIndex,
          remainingMs: config.speeches[nextIndex]?.durationMs ?? 0,
          running: false
        },
        startedAtMs: null,
        changed: true
      };
    }
  }

  const prepRemaining = input.mode === "prep"
    ? { ...input.prepRemaining, [input.prepSide]: 0 }
    : input.prepRemaining;
  return {
    state: { ...input, remainingMs: 0, prepRemaining, running: false },
    startedAtMs: null,
    changed: true
  };
}

export function sortEvidenceForViewer<T extends { uploaderId: string; updatedAt: string | Date }>(items: T[], viewerId: string): T[] {
  return [...items].sort((left, right) => {
    const ownership = Number(right.uploaderId === viewerId) - Number(left.uploaderId === viewerId);
    if (ownership !== 0) return ownership;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}
