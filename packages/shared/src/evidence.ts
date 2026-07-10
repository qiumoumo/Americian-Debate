import type { Evidence, Side } from "./index";

// ── Evidence 标准化：字段常量、解析器、引用校验 ──────────────────────
// 借鉴 OpenDebate/debate-cards 的卡片解析思路，纯启发式、可离线、可单测。
// client（导入预览）与 server（写库前校验）共用同一套逻辑。

/** quote 超过此长度视为过长（引用应精简，超长通常是整段粘贴）。 */
export const EVIDENCE_QUOTE_MAX = 2500;

/** 统一的 side 取值（与 Side 类型对应），用于下拉与解析归一。 */
export const EVIDENCE_SIDES: Side[] = ["Aff", "Neg", "Pro", "Con", "Generic"];

/** 解析产出的草稿卡（未入库，字段与 Evidence 对齐但不含 id/documentId）。 */
export interface EvidenceDraft {
  title: string;
  claim: string;
  quote: string;
  sourceUrl: string;
  author?: string;
  publication?: string;
  publishedDate?: string;
  side: Side;
  tags: string[];
}

export type EvidenceIssueCode =
  | "missing-claim"
  | "missing-quote"
  | "missing-source"
  | "missing-date"
  | "quote-too-long"
  | "invalid-url";

export type EvidenceIssueLevel = "error" | "warning";

export interface EvidenceIssue {
  code: EvidenceIssueCode;
  level: EvidenceIssueLevel;
  message: string;
}

/** 可被校验的最小字段集合（EvidenceDraft 与已入库 Evidence 都满足）。 */
export type ValidatableEvidence = Pick<
  Evidence,
  "claim" | "quote" | "sourceUrl" | "publishedDate"
>;

// ── 解析辅助 ────────────────────────────────────────────────────────

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+/i;
// ISO 日期或独立的 4 位年份（1900–2099），避免匹配到普通数字。
const DATE_RE = /\b(?:(?:19|20)\d{2}-\d{2}-\d{2}|(?:19|20)\d{2})\b/;
const TAG_RE = /#([\p{L}\p{N}_-]+)/gu;

const LABEL_ALIASES: Record<string, keyof EvidenceDraft> = {
  title: "title",
  标题: "title",
  claim: "claim",
  主张: "claim",
  论点: "claim",
  tag: "tags",
  tags: "tags",
  标签: "tags",
  quote: "quote",
  引用: "quote",
  原文: "quote",
  card: "quote",
  source: "sourceUrl",
  url: "sourceUrl",
  link: "sourceUrl",
  来源: "sourceUrl",
  链接: "sourceUrl",
  author: "author",
  作者: "author",
  cite: "author",
  publication: "publication",
  publisher: "publication",
  刊物: "publication",
  出处: "publication",
  date: "publishedDate",
  published: "publishedDate",
  year: "publishedDate",
  日期: "publishedDate",
  年份: "publishedDate",
  side: "side",
  立场: "side"
};

const SIDE_NORMALIZE: Record<string, Side> = {
  aff: "Aff",
  affirmative: "Aff",
  正方: "Aff",
  neg: "Neg",
  negative: "Neg",
  反方: "Neg",
  pro: "Pro",
  con: "Con",
  generic: "Generic",
  general: "Generic",
  通用: "Generic"
};

function normalizeSide(value: string | undefined): Side {
  if (!value) return "Generic";
  return SIDE_NORMALIZE[value.trim().toLowerCase()] ?? "Generic";
}

function extractTags(text: string): string[] {
  const tags = new Set<string>();
  for (const match of text.matchAll(TAG_RE)) {
    tags.add(match[1]);
  }
  return Array.from(tags);
}

function splitTagList(value: string): string[] {
  return value
    .split(/[,，;；#]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * 把整段粘贴文本切成多张卡片的原始块。
 * 分隔符：一行仅由 --- / === / *** 组成，或 markdown #### 标题，或连续空行。
 */
function splitBlocks(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const byRule = normalized.split(/\n[ \t]*(?:-{3,}|={3,}|\*{3,})[ \t]*\n/g);
  const blocks: string[] = [];
  for (const chunk of byRule) {
    // 连续 2+ 空行也视为分块边界。
    for (const piece of chunk.split(/\n{2,}\n*/g)) {
      const trimmed = piece.trim();
      if (trimmed) {
        blocks.push(trimmed);
      }
    }
  }
  return blocks;
}

function tryParseLabeled(block: string): EvidenceDraft | null {
  const lines = block.split("\n");
  const found: Partial<Record<keyof EvidenceDraft, string>> = {};
  let hitLabel = false;
  let currentKey: keyof EvidenceDraft | null = null;

  for (const line of lines) {
    const match = line.match(/^\s*([\p{L}]+)\s*[:：]\s*(.*)$/u);
    const key = match ? LABEL_ALIASES[match[1].trim().toLowerCase()] : undefined;
    if (match && key) {
      hitLabel = true;
      currentKey = key;
      found[key] = (found[key] ? found[key] + " " : "") + match[2].trim();
    } else if (currentKey) {
      // 续行拼接到当前字段（quote 常跨多行）。
      found[currentKey] = `${found[currentKey] ?? ""}\n${line}`.trim();
    }
  }

  if (!hitLabel) return null;

  const quote = (found.quote ?? "").trim();
  const title = (found.title ?? "").trim() || (found.claim ?? "").trim() || quote.slice(0, 80);
  return {
    title,
    claim: (found.claim ?? "").trim() || title,
    quote,
    sourceUrl: (found.sourceUrl ?? "").trim(),
    author: (found.author ?? "").trim() || undefined,
    publication: (found.publication ?? "").trim() || undefined,
    publishedDate: (found.publishedDate ?? "").trim() || undefined,
    side: normalizeSide(found.side),
    tags: found.tags ? splitTagList(found.tags) : extractTags(block)
  };
}

/**
 * 辩论卡式：首行=tag/title，其后为出处行（含 URL / 作者 / 年份），其余=引用正文。
 * 尽量从自由文本里抽取 URL、日期、作者。
 */
function parseCardHeuristic(block: string): EvidenceDraft {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  const title = (lines[0] ?? "").replace(/^#+\s*/, "").slice(0, 160) || "Untitled card";
  const body = lines.slice(1);

  const urlMatch = block.match(URL_RE);
  const sourceUrl = urlMatch ? urlMatch[0].replace(/[.,;]+$/, "") : "";
  const dateMatch = block.match(DATE_RE);
  const publishedDate = dateMatch ? dateMatch[0] : undefined;

  // 出处行：包含 URL 或年份的第一行（去掉 URL 后余下作为 author/publication）。
  const citeLine = body.find((line) => URL_RE.test(line) || DATE_RE.test(line));
  let author: string | undefined;
  if (citeLine) {
    const beforeDate = publishedDate ? citeLine.split(publishedDate)[0] : citeLine;
    author = beforeDate
      .replace(URL_RE, "")
      .replace(/[",，\-–—]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim() || undefined;
    if (author && author.length > 120) {
      author = undefined; // 太长多半是正文，不当作者。
    }
  }

  // 引用正文：去掉标题行与出处行后的其余内容；为空则退回整块。
  const quoteLines = body.filter((line) => line !== citeLine);
  const quote = (quoteLines.join("\n").trim() || body.join("\n").trim() || title).trim();

  return {
    title,
    claim: title,
    quote,
    sourceUrl,
    author,
    publication: undefined,
    publishedDate,
    side: "Generic",
    tags: extractTags(block)
  };
}

/** 解析单块文本为一张草稿卡（先试标签式，回退启发式）。 */
export function parseEvidenceBlock(block: string): EvidenceDraft {
  return tryParseLabeled(block) ?? parseCardHeuristic(block);
}

/** 解析整段粘贴文本为多张草稿卡。空输入返回空数组。 */
export function parseEvidenceCards(raw: string): EvidenceDraft[] {
  return splitBlocks(raw).map(parseEvidenceBlock);
}

// ── 校验（引用校验） ────────────────────────────────────────────────

/** 判断字符串是否为合法的 http(s) URL。 */
export function isValidHttpUrl(value: string): boolean {
  const raw = value.trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 引用校验：标记缺 source、缺 date、quote 过长、sourceUrl 无效、缺 claim/quote。
 * 返回问题列表（空数组=无问题）。
 */
export function validateEvidence(ev: ValidatableEvidence): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  const claim = (ev.claim ?? "").trim();
  const quote = (ev.quote ?? "").trim();
  const sourceUrl = (ev.sourceUrl ?? "").trim();
  const publishedDate = (ev.publishedDate ?? "").trim();

  if (!claim) {
    issues.push({ code: "missing-claim", level: "error", message: "缺少 claim（这条 evidence 支持什么论点？）" });
  }
  if (!quote) {
    issues.push({ code: "missing-quote", level: "error", message: "缺少 quote（原文引用）" });
  } else if (quote.length > EVIDENCE_QUOTE_MAX) {
    issues.push({
      code: "quote-too-long",
      level: "warning",
      message: `quote 过长（${quote.length} 字符，建议 ≤ ${EVIDENCE_QUOTE_MAX}）`
    });
  }
  if (!sourceUrl) {
    issues.push({ code: "missing-source", level: "warning", message: "缺少 source URL" });
  } else if (!isValidHttpUrl(sourceUrl)) {
    issues.push({ code: "invalid-url", level: "error", message: "source URL 无效（需 http:// 或 https://）" });
  }
  if (!publishedDate) {
    issues.push({ code: "missing-date", level: "warning", message: "缺少发表日期" });
  }

  return issues;
}

/** 是否存在 error 级问题（用于阻断/高亮）。 */
export function hasBlockingIssue(issues: EvidenceIssue[]): boolean {
  return issues.some((issue) => issue.level === "error");
}
