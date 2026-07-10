import type { DebateDocument, DebateFormat, Evidence, FlowCell, FlowCellStatus, FlowResponse, FlowRow, LibraryRoundRecord, MatchRecord, MatchResult, Side } from "@debate/shared";
import { readPlainTextDocument } from "@debate/editor";

export const sideToPrisma: Record<Side, "AFF" | "NEG" | "PRO" | "CON" | "GENERIC"> = {
  Aff: "AFF",
  Neg: "NEG",
  Pro: "PRO",
  Con: "CON",
  Generic: "GENERIC"
};

export const formatToPrisma: Record<DebateFormat, "PF" | "LD" | "POLICY" | "BP" | "CUSTOM"> = {
  PF: "PF",
  LD: "LD",
  Policy: "POLICY",
  BP: "BP",
  Custom: "CUSTOM"
};

export const resultToPrisma: Record<MatchResult, "WIN" | "LOSS" | "PENDING"> = {
  win: "WIN",
  loss: "LOSS",
  pending: "PENDING"
};

export function mapPrismaSide(side: string): Side {
  const map: Record<string, Side> = {
    AFF: "Aff",
    NEG: "Neg",
    PRO: "Pro",
    CON: "Con",
    GENERIC: "Generic"
  };
  return map[side] ?? "Generic";
}

export function mapPrismaFormat(format: string): DebateFormat {
  const map: Record<string, DebateFormat> = {
    PF: "PF",
    LD: "LD",
    POLICY: "Policy",
    BP: "BP",
    CUSTOM: "Custom"
  };
  return map[format] ?? "PF";
}

export function mapPrismaResult(result: string): MatchResult {
  const map: Record<string, MatchResult> = {
    WIN: "win",
    LOSS: "loss",
    PENDING: "pending"
  };
  return map[result] ?? "pending";
}

export function mapPrismaOutcome(outcome: string) {
  const map = {
    WON: "won",
    LOST: "lost",
    DROPPED: "dropped",
    TURNED: "turned",
    CONCEDED: "conceded"
  } as const;
  return map[outcome as keyof typeof map] ?? "lost";
}

export function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    try {
      return readStringArray(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

export function mapEvidence(record: {
  id: string;
  documentId: string;
  title: string;
  claim: string;
  quote: string;
  sourceUrl: string;
  author: string | null;
  publication: string | null;
  publishedDate: string | null;
  side: string;
  tagsJson: unknown;
}): Evidence {
  return {
    id: record.id,
    documentId: record.documentId,
    title: record.title,
    claim: record.claim,
    quote: record.quote,
    sourceUrl: record.sourceUrl,
    author: record.author ?? undefined,
    publication: record.publication ?? undefined,
    publishedDate: record.publishedDate ?? undefined,
    side: mapPrismaSide(record.side),
    tags: readStringArray(record.tagsJson)
  };
}

export function mapDocument(record: {
  id: string;
  title: string;
  description: string;
  contentJson: unknown;
  updatedAt: Date;
  evidence: Parameters<typeof mapEvidence>[0][];
}): DebateDocument {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    contentText: readPlainTextDocument(record.contentJson),
    updatedAt: record.updatedAt.toISOString().slice(0, 10),
    evidence: record.evidence.map(mapEvidence),
    permissions: ["owner"]
  };
}

export function mapMatch(record: {
  id: string;
  tournament: string;
  opponent: string;
  topic: string;
  format: string;
  side: string;
  result: string;
  tagsJson: unknown;
  reflection: { whatWorked: string; whatFailed: string; judgeFeedback: string; nextSteps: string } | null;
  argumentOutcomes: Array<{ id?: string; argument: string; side: string; outcome: string }>;
}): MatchRecord {
  return {
    id: record.id,
    tournament: record.tournament,
    opponent: record.opponent,
    topic: record.topic,
    format: mapPrismaFormat(record.format),
    side: mapPrismaSide(record.side),
    result: mapPrismaResult(record.result),
    tags: readStringArray(record.tagsJson),
    reflection: [
      record.reflection?.whatWorked,
      record.reflection?.whatFailed,
      record.reflection?.judgeFeedback,
      record.reflection?.nextSteps
    ].filter(Boolean).join(" ") || "No reflection yet.",
    argumentOutcomes: record.argumentOutcomes.map((outcome) => ({
      id: outcome.id,
      argument: outcome.argument,
      side: mapPrismaSide(outcome.side),
      outcome: mapPrismaOutcome(outcome.outcome)
    }))
  };
}

export const flowStatusToPrisma: Record<FlowCellStatus, "OPEN" | "EXTENDED" | "ANSWERED" | "DROPPED" | "TURNED" | "CONCEDED"> = {
  open: "OPEN",
  extended: "EXTENDED",
  answered: "ANSWERED",
  dropped: "DROPPED",
  turned: "TURNED",
  conceded: "CONCEDED"
};

export function mapPrismaFlowStatus(status: string): FlowCellStatus {
  const map: Record<string, FlowCellStatus> = {
    OPEN: "open",
    EXTENDED: "extended",
    ANSWERED: "answered",
    DROPPED: "dropped",
    TURNED: "turned",
    CONCEDED: "conceded"
  };
  return map[status] ?? "open";
}

const FLOW_RESPONSE_KINDS = ["response", "answer", "turn", "weigh", "collapse"] as const;

export function mapFlowResponseKind(kind: string): FlowResponse["kind"] {
  return (FLOW_RESPONSE_KINDS as readonly string[]).includes(kind) ? (kind as FlowResponse["kind"]) : "response";
}

export function mapFlowResponse(record: {
  id: string;
  order: number;
  side: string;
  kind: string;
  content: string;
  evidenceIdsJson: unknown;
  status: string;
}): FlowResponse {
  return {
    id: record.id,
    order: record.order,
    side: mapPrismaSide(record.side),
    kind: mapFlowResponseKind(record.kind),
    content: record.content,
    evidenceIds: readStringArray(record.evidenceIdsJson),
    status: mapPrismaFlowStatus(record.status)
  };
}

export function mapFlowCell(record: {
  id: string;
  speechType: string;
  speechOrder: number;
  content: string;
  evidenceIdsJson: unknown;
  status: string;
  responses?: Parameters<typeof mapFlowResponse>[0][];
}): FlowCell {
  return {
    id: record.id,
    speechType: record.speechType,
    speechOrder: record.speechOrder,
    content: record.content,
    evidenceIds: readStringArray(record.evidenceIdsJson),
    status: mapPrismaFlowStatus(record.status),
    responses: (record.responses ?? []).map(mapFlowResponse)
  };
}

export function mapFlowRow(record: {
  id: string;
  matchId: string;
  side: string;
  title: string;
  category: string;
  order: number;
  weighMagnitude?: string;
  weighProbability?: string;
  weighTimeframe?: string;
  weighScope?: string;
  cells: Parameters<typeof mapFlowCell>[0][];
}): FlowRow {
  return {
    id: record.id,
    matchId: record.matchId,
    side: mapPrismaSide(record.side),
    title: record.title,
    category: record.category,
    order: record.order,
    weighing: {
      magnitude: record.weighMagnitude ?? "",
      probability: record.weighProbability ?? "",
      timeframe: record.weighTimeframe ?? "",
      scope: record.weighScope ?? ""
    },
    cells: record.cells.map(mapFlowCell)
  };
}

// ── Round Library（素材库）──────────────────────────────────────
export function mapLibraryRound(record: {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  topic: string;
  format: string;
  teams: string;
  year: string;
  tournament: string;
  tagsJson: unknown;
  createdAt: Date;
  updatedAt: Date;
  notes: Array<{ id: string; timestampSeconds: number | null; body: string; createdAt: Date }>;
}): LibraryRoundRecord {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    videoUrl: record.videoUrl,
    topic: record.topic,
    format: mapPrismaFormat(record.format),
    teams: record.teams,
    year: record.year,
    tournament: record.tournament,
    tags: readStringArray(record.tagsJson),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    notes: record.notes.map((note) => ({
      id: note.id,
      timestampSeconds: note.timestampSeconds,
      body: note.body,
      createdAt: note.createdAt.toISOString()
    }))
  };
}

/** "90" | "1:30" | "1:02:03" -> 秒；"" -> null；非法 -> null。 */
export function parseTimestampToSeconds(raw: string): number | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }
  const parts = value.split(":").map((part) => Number(part));
  if (parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    return null;
  }
  const seconds = parts.reduce((acc, n) => acc * 60 + n, 0);
  return Number.isFinite(seconds) ? Math.floor(seconds) : null;
}

/** 秒 -> "m:ss"（超过一小时用 "h:mm:ss"）；null -> ""。 */
export function formatTimestamp(seconds: number | null): string {
  if (seconds == null) {
    return "";
  }
  const s = seconds % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/**
 * 不可信视频 URL 边界：只对 youtube / vimeo 生成硬编码 host + 严格校验 id 的 embed URL，
 * 其余（未知 host、非 http(s)、javascript: 等）一律回退为普通外链。绝不把原始 URL 放进 iframe src。
 */
export function resolveVideoEmbed(url: string): { kind: "youtube" | "vimeo" | "link"; embedUrl: string | null } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "link", embedUrl: null };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { kind: "link", embedUrl: null };
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const idOk = (id: string) => /^[A-Za-z0-9_-]{6,20}$/.test(id);

  if (host === "youtube.com" || host === "m.youtube.com") {
    const id = parsed.searchParams.get("v") ?? "";
    if (idOk(id)) {
      return { kind: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
    }
  }
  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1);
    if (idOk(id)) {
      return { kind: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
    }
  }
  if (host === "vimeo.com") {
    const id = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    if (/^\d{6,12}$/.test(id)) {
      return { kind: "vimeo", embedUrl: `https://player.vimeo.com/video/${id}` };
    }
  }
  return { kind: "link", embedUrl: null };
}
