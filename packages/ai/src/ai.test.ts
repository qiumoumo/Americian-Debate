import assert from "node:assert/strict";
import test from "node:test";
import { estimateAIUsageCost } from "./index.ts";
import { buildMatchNotesCopyPrompt } from "./match-notes.ts";
import { buildFlowRebuttalCopyPrompt } from "./flow.ts";
import { buildPracticeOpponentCopyPrompt, buildPracticeSummaryCopyPrompt, summarizePracticeTranscript } from "./practice.ts";
import { normalizeFlowRebuttalSuggestions, normalizeGeneratedMatchNotes, normalizePracticeDrills, normalizePracticeFeedback } from "./schemas.ts";

test("buildMatchNotesCopyPrompt includes evidence and JSON-only instruction", () => {
  const prompt = buildMatchNotesCopyPrompt({
    side: "Aff",
    opponentContext: "They weigh fiscal costs.",
    speechEvidence: [
      {
        id: "ev-1",
        documentId: "doc-1",
        title: "Labor complementarity",
        claim: "Immigration complements native labor.",
        quote: "Complementarity raises specialization.",
        sourceUrl: "https://example.com",
        side: "Aff",
        tags: ["labor"]
      }
    ]
  });

  assert.match(prompt, /SYSTEM/);
  assert.match(prompt, /Return only JSON/);
  assert.match(prompt, /ev-1/);
  assert.match(prompt, /fiscal costs/);
});

test("normalizeGeneratedMatchNotes filters unapproved evidence ids", () => {
  const normalized = normalizeGeneratedMatchNotes({
    ourCase: [{
      speech: "Constructive",
      argument: "Extend labor.",
      evidenceIds: ["ev-1", "ev-2"],
      suggestedText: "Extend ev-1."
    }],
    frontlines: [{
      opponentArgument: "Costs",
      response: "Weigh long-run growth.",
      evidenceIds: ["ev-2"]
    }],
    risks: ["Do not overclaim."]
  }, ["ev-1"]);

  assert.deepEqual(normalized.ourCase[0]?.evidenceIds, ["ev-1"]);
  assert.deepEqual(normalized.frontlines[0]?.evidenceIds, []);
});

test("normalizePracticeFeedback clamps score, trims lists, and synthesizes a rubric for old rows", () => {
  const feedback = normalizePracticeFeedback({
    score: 144,
    feedback: "Good clash.",
    strengths: ["line by line"],
    weaknesses: ["late weighing"],
    nextDrills: ["30 second weighing"]
  });

  assert.equal(feedback.score, 100);
  assert.deepEqual(feedback.nextDrills, ["30 second weighing"]);
  // Backward-compat: rows without a rubric get a neutral one so the UI never crashes.
  assert.equal(feedback.rubric.clash.score, 70);
  assert.equal(feedback.rubric.lineByLineEfficiency.score, 70);
});

test("normalizePracticeFeedback clamps rubric dims and derives score from the mean when absent", () => {
  const feedback = normalizePracticeFeedback({
    feedback: "Rubric only.",
    rubric: {
      clash: { score: 80, comment: "clear clash" },
      evidenceExtension: { score: 200, comment: "over max" },
      weighing: { score: 60, comment: "add weighing" },
      collapse: { score: 40, comment: "collapse sooner" },
      lineByLineEfficiency: { score: 70, comment: "clean" }
    },
    strengths: [],
    weaknesses: [],
    nextDrills: []
  });

  assert.equal(feedback.rubric.evidenceExtension.score, 100);
  // mean of 80,100,60,40,70 = 70
  assert.equal(feedback.score, 70);
});

test("normalizePracticeDrills caps count, clamps duration, and drops empty drills", () => {
  const { drills } = normalizePracticeDrills({
    drills: [
      { title: "Weigh", instructions: "weigh it", targetDimension: "weighing", durationSeconds: 5, promptText: "weigh" },
      { title: "", instructions: "", targetDimension: "bogus", durationSeconds: 9999, promptText: "" },
      { title: "Collapse", instructions: "collapse", targetDimension: "collapse", durationSeconds: 60, promptText: "collapse" }
    ]
  });

  // Middle drill has no title/promptText → dropped.
  assert.equal(drills.length, 2);
  assert.equal(drills[0].durationSeconds, 15); // clamped up to MIN
  assert.equal(drills[0].targetDimension, "weighing");
});

test("estimateAIUsageCost reports configured model and non-negative cents", () => {
  const estimate = estimateAIUsageCost({
    providerId: "openai-compatible",
    model: "deepseek-chat",
    input: "short input",
    output: "short output"
  });

  assert.equal(estimate.model, "deepseek-chat");
  assert.ok(estimate.inputTokenEstimate > 0);
  assert.ok(estimate.costEstimateCents >= 0);
});

test("normalizeFlowRebuttalSuggestions drops evidence ids outside the allowed set", () => {
  const normalized = normalizeFlowRebuttalSuggestions({
    responses: [
      { label: "Turn", category: "turn", response: "Weigh long-run growth.", strategy: "turn", evidenceIds: ["ev-1", "ev-9"] },
      { label: "Empty", category: "answer", response: "", strategy: "delink", evidenceIds: ["ev-1"] }
    ],
    weighing: ["Timeframe first."]
  }, ["ev-1"]);

  assert.equal(normalized.responses.length, 1);
  assert.equal(normalized.responses[0]?.category, "turn");
  assert.deepEqual(normalized.responses[0]?.evidenceIds, ["ev-1"]);
  assert.deepEqual(normalized.weighing, ["Timeframe first."]);
});

test("normalizeFlowRebuttalSuggestions defaults an unknown category to answer", () => {
  const normalized = normalizeFlowRebuttalSuggestions({
    responses: [
      { label: "Mystery", category: "bogus", response: "Deny the link.", strategy: "delink", evidenceIds: [] }
    ],
    weighing: []
  });

  assert.equal(normalized.responses[0]?.category, "answer");
});

test("buildFlowRebuttalCopyPrompt includes opponent argument and evidence grounding rule", () => {
  const prompt = buildFlowRebuttalCopyPrompt({
    side: "Neg",
    speechType: "Rebuttal",
    opponentArgument: "Fiscal pressure outweighs growth.",
    evidence: [
      {
        id: "ev-1",
        documentId: "doc-1",
        title: "Productivity",
        claim: "Immigration raises productivity.",
        quote: "Long-run output rises.",
        sourceUrl: "https://example.com",
        side: "Neg",
        tags: ["econ"]
      }
    ]
  });

  assert.match(prompt, /Fiscal pressure/);
  assert.match(prompt, /Only reference evidence IDs/);
  assert.match(prompt, /ev-1/);
});

test("buildPracticeSummaryCopyPrompt folds prior summary and new turns", () => {
  const prompt = buildPracticeSummaryCopyPrompt({
    topic: "AI safety regulation",
    format: "LD",
    side: "Neg",
    priorSummary: "Aff ran a standards case.",
    turnsToCompress: [
      { role: "user", content: "I extend my framework." },
      { role: "assistant", content: "Your framework drops the cost turn." }
    ]
  });

  assert.match(prompt, /priorSummary/);
  assert.match(prompt, /Aff ran a standards case/);
  assert.match(prompt, /cost turn/);
});

test("buildPracticeOpponentCopyPrompt injects conversationSummary when provided", () => {
  const prompt = buildPracticeOpponentCopyPrompt({
    topic: "AI safety regulation",
    format: "LD",
    side: "Neg",
    transcript: [],
    userMessage: "New speech.",
    context: { conversationSummary: "Earlier: Aff conceded the link." }
  });

  assert.match(prompt, /conversationSummary/);
  assert.match(prompt, /Aff conceded the link/);
});

test("summarizePracticeTranscript returns prior summary when nothing to compress", async () => {
  const provider = {
    id: "mock" as const,
    async chat() {
      throw new Error("should not be called");
    },
    async generateStructured() {
      throw new Error("should not be called");
    },
    getCapabilities() {
      return {
        supportsStreaming: false,
        supportsJsonSchema: true,
        supportsToolUse: false,
        supportsVision: false,
        supportsLongContext: false
      };
    }
  };

  const summary = await summarizePracticeTranscript({
    provider,
    topic: "AI safety regulation",
    format: "LD",
    side: "Neg",
    priorSummary: "Existing summary.",
    turnsToCompress: []
  });

  assert.equal(summary, "Existing summary.");
});

test("summarizePracticeTranscript falls back to prior summary when provider returns empty text", async () => {
  const provider = {
    id: "mock" as const,
    async chat() {
      return { providerId: "mock" as const, model: "mock-local", text: "   " };
    },
    async generateStructured() {
      throw new Error("should not be called");
    },
    getCapabilities() {
      return {
        supportsStreaming: false,
        supportsJsonSchema: true,
        supportsToolUse: false,
        supportsVision: false,
        supportsLongContext: false
      };
    }
  };

  const summary = await summarizePracticeTranscript({
    provider,
    topic: "AI safety regulation",
    format: "LD",
    side: "Neg",
    priorSummary: "Kept summary.",
    turnsToCompress: [{ role: "user", content: "hello" }]
  });

  assert.equal(summary, "Kept summary.");
});
