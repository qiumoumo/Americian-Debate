import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EVIDENCE_QUOTE_MAX,
  isValidHttpUrl,
  parseEvidenceCards,
  validateEvidence
} from "./evidence.ts";

describe("parseEvidenceCards", () => {
  it("returns empty array for blank input", () => {
    assert.deepEqual(parseEvidenceCards(""), []);
    assert.deepEqual(parseEvidenceCards("   \n  \n"), []);
  });

  it("parses labeled fields (English + Chinese)", () => {
    const [card] = parseEvidenceCards(
      [
        "Title: Immigration expands labor supply",
        "Claim: Immigration raises productivity",
        "Quote: Immigrant labor complements native labor.",
        "Source: https://example.org/labor",
        "Author: National Academies",
        "Publication: Economic Effects Report",
        "Date: 2025",
        "Side: Aff",
        "Tags: economy, labor"
      ].join("\n")
    );

    assert.equal(card.title, "Immigration expands labor supply");
    assert.equal(card.claim, "Immigration raises productivity");
    assert.equal(card.quote, "Immigrant labor complements native labor.");
    assert.equal(card.sourceUrl, "https://example.org/labor");
    assert.equal(card.author, "National Academies");
    assert.equal(card.publication, "Economic Effects Report");
    assert.equal(card.publishedDate, "2025");
    assert.equal(card.side, "Aff");
    assert.deepEqual(card.tags, ["economy", "labor"]);
  });

  it("parses Chinese labels", () => {
    const [card] = parseEvidenceCards(
      ["标题: 移民扩大劳动力", "主张: 提升生产率", "引用: 原文内容。", "来源: https://example.org/x", "立场: 正方"].join("\n")
    );
    assert.equal(card.title, "移民扩大劳动力");
    assert.equal(card.claim, "提升生产率");
    assert.equal(card.sourceUrl, "https://example.org/x");
    assert.equal(card.side, "Aff");
  });

  it("splits multiple cards on --- and blank lines", () => {
    const cards = parseEvidenceCards(
      "Title: A\nQuote: one\n---\nTitle: B\nQuote: two\n\n\nTitle: C\nQuote: three"
    );
    assert.equal(cards.length, 3);
    assert.deepEqual(cards.map((c) => c.title), ["A", "B", "C"]);
  });

  it("parses a debate-card heuristic block (tag line + cite + body)", () => {
    const [card] = parseEvidenceCards(
      [
        "Warming causes extinction #climate #impact",
        "Smith, Nature, 2023, https://example.org/warming",
        "The scientific consensus indicates severe risks to ecosystems worldwide."
      ].join("\n")
    );
    assert.equal(card.title, "Warming causes extinction #climate #impact");
    assert.equal(card.sourceUrl, "https://example.org/warming");
    assert.equal(card.publishedDate, "2023");
    assert.ok(card.quote.includes("scientific consensus"));
    assert.deepEqual(card.tags.sort(), ["climate", "impact"]);
  });

  it("strips trailing punctuation from extracted URL", () => {
    const [card] = parseEvidenceCards("Header\nSee https://example.org/page.\nBody text here.");
    assert.equal(card.sourceUrl, "https://example.org/page");
  });
});

describe("validateEvidence", () => {
  const base = {
    claim: "c",
    quote: "q",
    sourceUrl: "https://example.org",
    publishedDate: "2025"
  };

  it("returns no issues for a complete card", () => {
    assert.deepEqual(validateEvidence(base), []);
  });

  it("flags missing claim and quote as errors", () => {
    const issues = validateEvidence({ ...base, claim: "", quote: "" });
    const codes = issues.map((i) => i.code);
    assert.ok(codes.includes("missing-claim"));
    assert.ok(codes.includes("missing-quote"));
    assert.ok(issues.every((i) => (i.code === "missing-claim" || i.code === "missing-quote") ? i.level === "error" : true));
  });

  it("flags missing source and date as warnings", () => {
    const issues = validateEvidence({ ...base, sourceUrl: "", publishedDate: "" });
    const byCode = new Map(issues.map((i) => [i.code, i]));
    assert.equal(byCode.get("missing-source")?.level, "warning");
    assert.equal(byCode.get("missing-date")?.level, "warning");
  });

  it("flags invalid url as error", () => {
    const issues = validateEvidence({ ...base, sourceUrl: "not-a-url" });
    assert.equal(issues.find((i) => i.code === "invalid-url")?.level, "error");
  });

  it("flags overlong quote as warning", () => {
    const issues = validateEvidence({ ...base, quote: "x".repeat(EVIDENCE_QUOTE_MAX + 1) });
    assert.equal(issues.find((i) => i.code === "quote-too-long")?.level, "warning");
  });
});

describe("isValidHttpUrl", () => {
  it("accepts http and https", () => {
    assert.ok(isValidHttpUrl("http://a.com"));
    assert.ok(isValidHttpUrl("https://a.com/x?y=1"));
  });
  it("rejects empty, non-http, and malformed", () => {
    assert.ok(!isValidHttpUrl(""));
    assert.ok(!isValidHttpUrl("ftp://a.com"));
    assert.ok(!isValidHttpUrl("javascript:alert(1)"));
    assert.ok(!isValidHttpUrl("//a.com"));
  });
});
