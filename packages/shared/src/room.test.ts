import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInviteCode,
  normalizeSharedTimer,
  sortEvidenceForViewer,
  type SharedTimerState
} from "./room.ts";

describe("createInviteCode", () => {
  it("creates a six-character code without ambiguous characters", () => {
    const code = createInviteCode(() => new Uint8Array([0, 1, 2, 3, 4, 5]));
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    assert.equal(code, "ABCDEF");
  });
});

describe("normalizeSharedTimer", () => {
  const running: SharedTimerState = {
    format: "PF",
    mode: "speech",
    speechIndex: 0,
    prepSide: "Aff",
    remainingMs: 120_000,
    prepRemaining: { Aff: 180_000, Neg: 180_000 },
    running: true,
    autoAdvance: true
  };

  it("derives remaining time from the server start timestamp", () => {
    const result = normalizeSharedTimer(running, 30_000, 10_000);
    assert.equal(result.state.remainingMs, 100_000);
    assert.equal(result.startedAtMs, 10_000);
  });

  it("advances an expired speech and stops on the next preset", () => {
    const result = normalizeSharedTimer({ ...running, remainingMs: 10_000 }, 25_000, 10_000);
    assert.equal(result.state.speechIndex, 1);
    assert.equal(result.state.running, false);
    assert.equal(result.startedAtMs, null);
    assert.equal(result.state.remainingMs, 240_000);
  });
});

describe("sortEvidenceForViewer", () => {
  it("places the viewer's evidence first and keeps recency within each group", () => {
    const sorted = sortEvidenceForViewer([
      { id: "other-new", uploaderId: "other", updatedAt: "2026-07-15T12:00:00.000Z" },
      { id: "mine-old", uploaderId: "me", updatedAt: "2026-07-13T12:00:00.000Z" },
      { id: "mine-new", uploaderId: "me", updatedAt: "2026-07-14T12:00:00.000Z" },
      { id: "other-old", uploaderId: "other", updatedAt: "2026-07-12T12:00:00.000Z" }
    ], "me");

    assert.deepEqual(sorted.map((item) => item.id), ["mine-new", "mine-old", "other-new", "other-old"]);
  });
});
