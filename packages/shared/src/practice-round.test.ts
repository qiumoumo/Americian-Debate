import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getPracticeRoundState } from "./index.ts";

describe("getPracticeRoundState", () => {
  it("maps PF Pro side to the Pro speech sequence (Constructive → Rebuttal → Summary → Final Focus)", () => {
    const first = getPracticeRoundState({ format: "PF", side: "Pro", userTurns: 0, mode: "text-spar" });
    assert.equal(first.currentSpeech?.speech, "Pro Constructive");
    assert.equal(first.currentSide, "Pro");
    assert.equal(first.totalUserSpeeches, 4);
    assert.equal(first.isComplete, false);

    const third = getPracticeRoundState({ format: "PF", side: "Pro", userTurns: 2, mode: "text-spar" });
    assert.equal(third.currentSpeech?.speech, "Pro Summary");
    assert.match(third.phaseLabel, /Pro Summary/);
  });

  it("maps LD Neg side to Neg speeches and advances by user turns", () => {
    const state = getPracticeRoundState({ format: "LD", side: "Neg", userTurns: 0, mode: "speech-drill" });
    assert.equal(state.currentSpeech?.speech, "1NC");
    // LD Neg has 1NC + NR = 2 flowable speeches.
    assert.equal(state.totalUserSpeeches, 2);

    const second = getPracticeRoundState({ format: "LD", side: "Neg", userTurns: 1, mode: "speech-drill" });
    assert.equal(second.currentSpeech?.speech, "NR");
  });

  it("maps LD Aff and reports completion after the last speech", () => {
    const state = getPracticeRoundState({ format: "LD", side: "Aff", userTurns: 0, mode: "text-spar" });
    assert.equal(state.currentSpeech?.speech, "1AC");
    // LD Aff: 1AC, 1AR, 2AR = 3 speeches.
    assert.equal(state.totalUserSpeeches, 3);

    const done = getPracticeRoundState({ format: "LD", side: "Aff", userTurns: 3, mode: "text-spar" });
    assert.equal(done.isComplete, true);
    assert.equal(done.currentSpeech, null);
    assert.equal(done.userSpeaksNext, false);
  });

  it("maps Policy Neg to the 2NR when stepping through neg speeches", () => {
    // Policy Neg flowable: 1NC, 2NC, 1NR, 2NR = 4.
    const state = getPracticeRoundState({ format: "Policy", side: "Neg", userTurns: 0, mode: "text-spar" });
    assert.equal(state.currentSpeech?.speech, "1NC");
    assert.equal(state.totalUserSpeeches, 4);

    const last = getPracticeRoundState({ format: "Policy", side: "Neg", userTurns: 3, mode: "text-spar" });
    assert.equal(last.currentSpeech?.speech, "2NR");
  });

  it("resolves crossfire mode to the nearest crossfire segment with Generic side", () => {
    const state = getPracticeRoundState({ format: "PF", side: "Pro", userTurns: 5, mode: "crossfire" });
    assert.equal(state.currentSpeech?.kind, "crossfire");
    assert.equal(state.currentSide, "Generic");
    assert.match(state.phaseLabel, /质询对抗/);
  });

  it("pins rebuttal-drill and weighing-drill to fixed speeches", () => {
    const rebuttal = getPracticeRoundState({ format: "LD", side: "Aff", userTurns: 0, mode: "rebuttal-drill" });
    assert.equal(rebuttal.currentSpeech?.speech, "1AR");
    assert.match(rebuttal.phaseLabel, /反驳训练/);

    const weighing = getPracticeRoundState({ format: "LD", side: "Aff", userTurns: 0, mode: "weighing-drill" });
    assert.equal(weighing.currentSpeech?.speech, "2AR");
    assert.match(weighing.phaseLabel, /权衡训练/);
  });

  it("falls back to a simple walk for Generic sides (BP)", () => {
    const state = getPracticeRoundState({ format: "BP", side: "Generic", userTurns: 0, mode: "text-spar" });
    assert.ok(state.currentSpeech, "should resolve a speech via fallback");
    assert.ok(state.totalUserSpeeches > 0);
  });
});
