import { db, type Prisma } from "@debate/db";
import type { ArgumentOutcome, DebateFormat, MatchResult, Side } from "@debate/shared";
import { formatToPrisma, mapPrismaFormat, mapPrismaOutcome, mapPrismaResult, mapPrismaSide, readStringArray, resultToPrisma, sideToPrisma } from "./mappers.ts";

const outcomeToPrisma: Record<ArgumentOutcome, "WON" | "LOST" | "DROPPED" | "TURNED" | "CONCEDED"> = {
  won: "WON",
  lost: "LOST",
  dropped: "DROPPED",
  turned: "TURNED",
  conceded: "CONCEDED"
};

const validFormats = new Set<unknown>(["PF", "LD", "Policy", "BP", "Custom"]);
const validSides = new Set<unknown>(["Aff", "Neg", "Pro", "Con", "Generic"]);
const validResults = new Set<unknown>(["win", "loss", "pending"]);
const validOutcomes = new Set<unknown>(["won", "lost", "dropped", "turned", "conceded"]);

export interface MatchReportActor {
  userId: string;
  workspaceId: string;
}

export type MatchReportErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION_FAILED" | "REVISION_CONFLICT";

export class MatchReportError extends Error {
  readonly code: MatchReportErrorCode;
  readonly issues: Record<string, string>;

  constructor(code: MatchReportErrorCode, message: string, issues: Record<string, string> = {}) {
    super(message);
    this.name = "MatchReportError";
    this.code = code;
    this.issues = issues;
  }
}

export interface MatchHistoryFilters {
  keyword?: string;
  result?: MatchResult | "all";
  side?: Side | "all";
  dateFrom?: string;
  dateTo?: string;
}

export interface MatchHistoryItem {
  id: string;
  tournament: string;
  roundNumber: string | null;
  opponent: string;
  topic: string;
  format: DebateFormat;
  side: Side;
  result: MatchResult;
  judge: string | null;
  date: string;
  tags: string[];
  source: "room" | "historical";
  reportSubmittedAt: string | null;
  reportRevision: number;
  createdBy: { id: string; name: string };
  canEdit: boolean;
  argumentOutcomeCount: number;
  evidenceCount: number;
  hasReflection: boolean;
}

export interface MatchHistoryStats {
  rounds: number;
  decidedRounds: number;
  wins: number;
  winRate: number;
  affWinRate: number;
  negWinRate: number;
  argumentOutcomes: Record<ArgumentOutcome | "total", number>;
}

export interface MatchHistoryView {
  reports: MatchHistoryItem[];
  pending: MatchHistoryItem[];
  stats: MatchHistoryStats;
}

export interface MatchReportArgumentOutcomeView {
  id: string | null;
  argument: string;
  side: Side;
  category: string;
  outcome: ArgumentOutcome | null;
  confidence: number;
  notes: string;
  position: number;
  suggested: boolean;
}

export interface MatchReportEvidenceOption {
  evidenceId: string;
  title: string;
  claim: string;
  quote: string;
  sourceUrl: string;
  side: Side;
  documentTitle: string;
  uploaderName: string;
  selected: boolean;
  speechType: string | null;
  effectivenessRating: number | null;
  notes: string;
}

export interface MatchReportReflection {
  whatWorked: string;
  whatFailed: string;
  judgeFeedback: string;
  nextSteps: string;
}

export interface MatchReportView {
  id: string;
  tournament: string;
  roundNumber: string | null;
  opponent: string;
  topic: string;
  format: DebateFormat;
  side: Side;
  result: MatchResult;
  judge: string | null;
  date: string;
  tags: string[];
  source: "room" | "historical";
  reportSubmittedAt: string | null;
  reportRevision: number;
  createdBy: { id: string; name: string };
  canEdit: boolean;
  access: "workspace" | "room";
  argumentOutcomes: MatchReportArgumentOutcomeView[];
  evidenceOptions: MatchReportEvidenceOption[];
  reflection: MatchReportReflection;
}

export interface MatchReportArgumentOutcomeInput {
  argument: string;
  side: Side;
  category: string;
  outcome: ArgumentOutcome;
  confidence: number;
  notes: string;
}

export interface MatchReportEvidenceInput {
  evidenceId: string;
  speechType?: string | null;
  effectivenessRating: number | null;
  notes: string;
}

export interface MatchReportPayload {
  tournament: string;
  roundNumber: string;
  opponent: string;
  topic: string;
  format: DebateFormat;
  side: Side;
  result: MatchResult;
  judge: string;
  date: string;
  tags: string[];
  argumentOutcomes: MatchReportArgumentOutcomeInput[];
  evidence: MatchReportEvidenceInput[];
  reflection: MatchReportReflection;
}

export type SaveMatchReportCommand =
  | { target: { kind: "existing"; matchId: string; expectedRevision: number }; report: MatchReportPayload }
  | { target: { kind: "historical" }; report: MatchReportPayload };

export interface SaveMatchReportResult {
  matchId: string;
  reportRevision: number;
  reportSubmittedAt: string;
  created: boolean;
}

async function requireActor(actor: MatchReportActor) {
  const membership = await db.membership.findUnique({
    where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } },
    include: { user: true, workspace: true }
  });
  if (!membership || membership.user.disabledAt || membership.workspace.deletedAt) {
    throw new MatchReportError("FORBIDDEN", "Current workspace access is no longer available");
  }
  return membership;
}

function emptyStats(): MatchHistoryStats {
  return {
    rounds: 0,
    decidedRounds: 0,
    wins: 0,
    winRate: 0,
    affWinRate: 0,
    negWinRate: 0,
    argumentOutcomes: { total: 0, won: 0, lost: 0, dropped: 0, turned: 0, conceded: 0 }
  };
}

async function visibleEvidenceIds(tx: Prisma.TransactionClient, report: MatchReportPayload) {
  const ids = Array.from(new Set(report.evidence.map((item) => String(item.evidenceId ?? "").trim()).filter(Boolean)));
  if (!ids.length) return new Set<string>();
  const evidence = await tx.evidence.findMany({
    where: {
      id: { in: ids },
      document: { deletedAt: null, workspace: { deletedAt: null }, owner: { disabledAt: null } }
    },
    select: { id: true }
  });
  return new Set(evidence.map((item) => item.id));
}

function validateReport(report: MatchReportPayload, visibleEvidence: Set<string>) {
  const issues: Record<string, string> = {};
  if (typeof report.tournament !== "string" || !report.tournament.trim()) issues.tournament = "Tournament is required";
  if (typeof report.opponent !== "string" || !report.opponent.trim()) issues.opponent = "Opponent is required";
  if (typeof report.topic !== "string" || !report.topic.trim()) issues.topic = "Topic is required";
  if (!validFormats.has(report.format)) issues.format = "Format is invalid";
  if (!validSides.has(report.side)) issues.side = "Side is invalid";
  if (!validResults.has(report.result)) issues.result = "Result is invalid";

  const rawDate = typeof report.date === "string" ? report.date.trim() : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== rawDate) {
    issues.date = "Date must be valid";
  }

  if (!Array.isArray(report.argumentOutcomes)) {
    issues.argumentOutcomes = "Argument outcomes must be a list";
  } else {
    report.argumentOutcomes.forEach((outcome, index) => {
      if (typeof outcome.argument !== "string" || !outcome.argument.trim()) {
        issues[`argumentOutcomes.${index}.argument`] = "Argument is required";
      }
      if (!validSides.has(outcome.side)) issues[`argumentOutcomes.${index}.side`] = "Side is invalid";
      if (!validOutcomes.has(outcome.outcome)) issues[`argumentOutcomes.${index}.outcome`] = "Outcome is invalid";
      if (!Number.isInteger(outcome.confidence) || outcome.confidence < 1 || outcome.confidence > 5) {
        issues[`argumentOutcomes.${index}.confidence`] = "Confidence must be between 1 and 5";
      }
    });
  }

  const seenEvidence = new Set<string>();
  if (!Array.isArray(report.evidence)) {
    issues.evidence = "Evidence must be a list";
  } else {
    report.evidence.forEach((evidence, index) => {
      const evidenceId = typeof evidence.evidenceId === "string" ? evidence.evidenceId.trim() : "";
      if (!evidenceId || !visibleEvidence.has(evidenceId)) {
        issues[`evidence.${index}.evidenceId`] = "Evidence is not visible";
      } else if (seenEvidence.has(evidenceId)) {
        issues[`evidence.${index}.evidenceId`] = "Evidence can only be selected once";
      }
      seenEvidence.add(evidenceId);
      if (!Number.isInteger(evidence.effectivenessRating) || evidence.effectivenessRating === null ||
        evidence.effectivenessRating < 1 || evidence.effectivenessRating > 5) {
        issues[`evidence.${index}.effectivenessRating`] = "Effectiveness must be between 1 and 5";
      }
    });
  }

  const reflection = report.reflection as MatchReportReflection | undefined;
  if (!reflection || typeof reflection.whatWorked !== "string") issues["reflection.whatWorked"] = "What worked must be text";
  if (!reflection || typeof reflection.whatFailed !== "string") issues["reflection.whatFailed"] = "What failed must be text";
  if (!reflection || typeof reflection.judgeFeedback !== "string") issues["reflection.judgeFeedback"] = "Judge feedback must be text";
  if (!reflection || typeof reflection.nextSteps !== "string") issues["reflection.nextSteps"] = "Next steps must be text";

  if (Object.keys(issues).length) {
    throw new MatchReportError("VALIDATION_FAILED", "Match report contains invalid fields", issues);
  }
  return date as Date;
}

function normalizeWriteError(error: unknown): never {
  if (error instanceof MatchReportError) throw error;
  throw new MatchReportError("VALIDATION_FAILED", "Match report could not be saved");
}

export async function getMatchHistory(actor: MatchReportActor, filters: MatchHistoryFilters = {}): Promise<MatchHistoryView> {
  const membership = await requireActor(actor);
  const filterIssues: Record<string, string> = {};
  const readFilterDate = (value: string | undefined, key: "dateFrom" | "dateTo") => {
    if (!value) return null;
    const trimmed = value.trim();
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? new Date(`${trimmed}T00:00:00.000Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
      filterIssues[key] = "Date filter must be valid";
      return null;
    }
    return trimmed;
  };
  const dateFrom = readFilterDate(filters.dateFrom, "dateFrom");
  const dateTo = readFilterDate(filters.dateTo, "dateTo");
  if (filters.result && filters.result !== "all" && !validResults.has(filters.result)) filterIssues.result = "Result filter is invalid";
  if (filters.side && filters.side !== "all" && !validSides.has(filters.side)) filterIssues.side = "Side filter is invalid";
  if (dateFrom && dateTo && dateFrom > dateTo) filterIssues.dateTo = "End date must be on or after start date";
  if (Object.keys(filterIssues).length) {
    throw new MatchReportError("VALIDATION_FAILED", "Match history filters are invalid", filterIssues);
  }

  const matches = await db.match.findMany({
    where: { workspaceId: actor.workspaceId, deletedAt: null },
    include: {
      user: { select: { id: true, name: true } },
      room: { select: { ownerId: true } },
      reflection: { select: { whatWorked: true, whatFailed: true, judgeFeedback: true, nextSteps: true } },
      argumentOutcomes: { select: { outcome: true } },
      evidence: { select: { id: true } }
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "asc" }]
  });

  const mapped = matches.map((match) => {
    const canEdit = membership.role !== "VIEWER" && (
      match.userId === actor.userId || match.room?.ownerId === actor.userId ||
      membership.role === "OWNER" || membership.role === "COACH"
    );
    const reflectionValues = match.reflection
      ? [match.reflection.whatWorked, match.reflection.whatFailed, match.reflection.judgeFeedback, match.reflection.nextSteps]
      : [];
    const item: MatchHistoryItem = {
      id: match.id,
      tournament: match.tournament,
      roundNumber: match.roundNumber,
      opponent: match.opponent,
      topic: match.topic,
      format: mapPrismaFormat(match.format),
      side: mapPrismaSide(match.side),
      result: mapPrismaResult(match.result),
      judge: match.judge,
      date: match.date.toISOString().slice(0, 10),
      tags: readStringArray(match.tagsJson),
      source: match.room ? "room" : "historical",
      reportSubmittedAt: match.reportSubmittedAt?.toISOString() ?? null,
      reportRevision: match.reportRevision,
      createdBy: match.user,
      canEdit,
      argumentOutcomeCount: match.argumentOutcomes.length,
      evidenceCount: match.evidence.length,
      hasReflection: reflectionValues.some((value) => value.trim().length > 0)
    };
    return { item, outcomes: match.argumentOutcomes };
  });

  const keyword = filters.keyword?.trim().toLocaleLowerCase() ?? "";
  const reports = mapped.filter(({ item }) => {
    if (!item.reportSubmittedAt) return false;
    if (filters.result && filters.result !== "all" && item.result !== filters.result) return false;
    if (filters.side && filters.side !== "all" && item.side !== filters.side) return false;
    if (dateFrom && item.date < dateFrom) return false;
    if (dateTo && item.date > dateTo) return false;
    if (keyword) {
      const searchable = [item.tournament, item.roundNumber ?? "", item.opponent, item.topic, item.judge ?? "", ...item.tags]
        .join(" ")
        .toLocaleLowerCase();
      if (!searchable.includes(keyword)) return false;
    }
    return true;
  });

  const stats = emptyStats();
  stats.rounds = reports.length;
  const decided = reports.filter(({ item }) => item.result !== "pending");
  stats.decidedRounds = decided.length;
  stats.wins = decided.filter(({ item }) => item.result === "win").length;
  stats.winRate = decided.length ? Math.round((stats.wins / decided.length) * 100) : 0;
  const affPro = decided.filter(({ item }) => item.side === "Aff" || item.side === "Pro");
  const negCon = decided.filter(({ item }) => item.side === "Neg" || item.side === "Con");
  stats.affWinRate = affPro.length ? Math.round((affPro.filter(({ item }) => item.result === "win").length / affPro.length) * 100) : 0;
  stats.negWinRate = negCon.length ? Math.round((negCon.filter(({ item }) => item.result === "win").length / negCon.length) * 100) : 0;
  for (const report of reports) {
    for (const outcome of report.outcomes) {
      const key = mapPrismaOutcome(outcome.outcome);
      stats.argumentOutcomes[key] += 1;
      stats.argumentOutcomes.total += 1;
    }
  }

  return {
    reports: reports.map(({ item }) => item),
    pending: mapped.filter(({ item }) => !item.reportSubmittedAt).map(({ item }) => item),
    stats
  };
}

export async function getMatchReport(actor: MatchReportActor, matchId: string): Promise<MatchReportView> {
  const membership = await requireActor(actor);
  const match = await db.match.findFirst({
    where: { id: matchId, deletedAt: null, workspace: { deletedAt: null } },
    include: {
      user: { select: { id: true, name: true } },
      room: { select: { id: true, ownerId: true, members: { where: { userId: actor.userId, status: "ACTIVE" }, select: { id: true } } } },
      reflection: true,
      argumentOutcomes: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      flowRows: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      evidence: {
        include: {
          evidence: { include: { document: { include: { owner: { select: { name: true } } } } } }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });
  if (!match) throw new MatchReportError("NOT_FOUND", "Match report not found");

  const workspaceAccess = match.workspaceId === actor.workspaceId;
  const roomAccess = Boolean(match.room?.members.length);
  if (!workspaceAccess && !roomAccess) throw new MatchReportError("FORBIDDEN", "Match report access denied");

  const visibleEvidence = await db.evidence.findMany({
    where: { document: { deletedAt: null, workspace: { deletedAt: null }, owner: { disabledAt: null } } },
    include: { document: { include: { owner: { select: { name: true } } } } },
    orderBy: { updatedAt: "desc" }
  });
  const evidenceLinks = new Map(match.evidence.map((link) => [link.evidenceId, link]));

  const canEdit = membership.role !== "VIEWER" && (
    match.userId === actor.userId || match.room?.ownerId === actor.userId ||
    (workspaceAccess && (membership.role === "OWNER" || membership.role === "COACH"))
  );

  return {
    id: match.id,
    tournament: match.tournament,
    roundNumber: match.roundNumber,
    opponent: match.opponent,
    topic: match.topic,
    format: mapPrismaFormat(match.format),
    side: mapPrismaSide(match.side),
    result: mapPrismaResult(match.result),
    judge: match.judge,
    date: match.date.toISOString().slice(0, 10),
    tags: readStringArray(match.tagsJson),
    source: match.room ? "room" : "historical",
    reportSubmittedAt: match.reportSubmittedAt?.toISOString() ?? null,
    reportRevision: match.reportRevision,
    createdBy: match.user,
    canEdit,
    access: workspaceAccess ? "workspace" : "room",
    argumentOutcomes: match.argumentOutcomes.length
      ? match.argumentOutcomes.map((outcome) => ({
          id: outcome.id,
          argument: outcome.argument,
          side: mapPrismaSide(outcome.side),
          category: outcome.category,
          outcome: mapPrismaOutcome(outcome.outcome),
          confidence: outcome.confidence,
          notes: outcome.notes,
          position: outcome.position,
          suggested: false
        }))
      : match.flowRows.filter((row) => row.title.trim()).map((row, position) => ({
          id: null,
          argument: row.title,
          side: mapPrismaSide(row.side),
          category: row.category,
          outcome: null,
          confidence: 3,
          notes: "",
          position,
          suggested: true
        })),
    evidenceOptions: visibleEvidence.map((evidence) => {
      const link = evidenceLinks.get(evidence.id);
      return {
        evidenceId: evidence.id,
        title: evidence.title,
        claim: evidence.claim,
        quote: evidence.quote,
        sourceUrl: evidence.sourceUrl,
        side: mapPrismaSide(evidence.side),
        documentTitle: evidence.document.title,
        uploaderName: evidence.document.owner.name,
        selected: Boolean(link),
        speechType: link?.speechType ?? null,
        effectivenessRating: link?.effectivenessRating ?? null,
        notes: link?.notes ?? ""
      };
    }).sort((left, right) => Number(right.selected) - Number(left.selected)),
    reflection: {
      whatWorked: match.reflection?.whatWorked ?? "",
      whatFailed: match.reflection?.whatFailed ?? "",
      judgeFeedback: match.reflection?.judgeFeedback ?? "",
      nextSteps: match.reflection?.nextSteps ?? ""
    }
  };
}

export async function saveMatchReport(actor: MatchReportActor, command: SaveMatchReportCommand): Promise<SaveMatchReportResult> {
  const membership = await requireActor(actor);
  if (command.target.kind === "existing") {
    const target = command.target;
    const submittedAt = new Date();
    const report = command.report;
    try {
      return await db.$transaction(async (tx) => {
      const match = await tx.match.findFirst({
        where: { id: target.matchId, deletedAt: null, workspace: { deletedAt: null } },
        include: {
          room: {
            select: {
              ownerId: true,
              members: { where: { userId: actor.userId, status: "ACTIVE" }, select: { id: true } }
            }
          }
        }
      });
      if (!match) throw new MatchReportError("NOT_FOUND", "Match report not found");

      const workspaceAccess = match.workspaceId === actor.workspaceId;
      const roomAccess = Boolean(match.room?.members.length);
      if (!workspaceAccess && !roomAccess) throw new MatchReportError("FORBIDDEN", "Match report access denied");
      const canEdit = membership.role !== "VIEWER" && (
        match.userId === actor.userId || match.room?.ownerId === actor.userId ||
        (workspaceAccess && (membership.role === "OWNER" || membership.role === "COACH"))
      );
      if (!canEdit) throw new MatchReportError("FORBIDDEN", "Match report is read only");

      const date = validateReport(report, await visibleEvidenceIds(tx, report));

      const firstSubmittedAt = match.reportSubmittedAt ?? submittedAt;
      const updated = await tx.match.updateMany({
        where: { id: match.id, reportRevision: target.expectedRevision },
        data: {
          tournament: report.tournament.trim(),
          roundNumber: report.roundNumber.trim() || null,
          opponent: report.opponent.trim(),
          topic: report.topic.trim(),
          format: formatToPrisma[report.format] ?? "PF",
          side: sideToPrisma[report.side] ?? "GENERIC",
          result: resultToPrisma[report.result] ?? "PENDING",
          judge: report.judge.trim() || null,
          date,
          tagsJson: report.tags.map((tag) => tag.trim()).filter(Boolean),
          reportSubmittedAt: firstSubmittedAt,
          reportRevision: { increment: 1 }
        }
      });
      if (updated.count !== 1) {
        throw new MatchReportError("REVISION_CONFLICT", "This match report was changed by someone else");
      }

      await tx.argumentOutcome.deleteMany({ where: { matchId: match.id } });
      if (report.argumentOutcomes.length) {
        await tx.argumentOutcome.createMany({
          data: report.argumentOutcomes.map((outcome, position) => ({
            matchId: match.id,
            position,
            argument: outcome.argument.trim(),
            side: sideToPrisma[outcome.side] ?? "GENERIC",
            category: outcome.category.trim() || "general",
            outcome: outcomeToPrisma[outcome.outcome],
            confidence: outcome.confidence,
            notes: outcome.notes
          }))
        });
      }
      await tx.matchEvidence.deleteMany({ where: { matchId: match.id } });
      if (report.evidence.length) {
        await tx.matchEvidence.createMany({
          data: report.evidence.map((evidence) => ({
            matchId: match.id,
            evidenceId: evidence.evidenceId,
            speechType: evidence.speechType?.trim() || null,
            effectivenessRating: evidence.effectivenessRating,
            notes: evidence.notes
          }))
        });
      }
      await tx.reflection.upsert({
        where: { matchId: match.id },
        create: { matchId: match.id, ...report.reflection },
        update: report.reflection
      });
      await tx.auditLog.create({
        data: {
          workspaceId: match.workspaceId,
          actorUserId: actor.userId,
          actorName: membership.user.name,
          action: match.reportSubmittedAt ? "match_report.revised" : "match_report.submitted",
          targetType: "Match",
          targetId: match.id,
          metaJson: { changeType: match.reportSubmittedAt ? "revised" : "submitted" }
        }
      });

      return {
        matchId: match.id,
        reportRevision: target.expectedRevision + 1,
        reportSubmittedAt: firstSubmittedAt.toISOString(),
        created: false
      };
      });
    } catch (error) {
      normalizeWriteError(error);
    }
  }
  if (membership.role === "VIEWER") {
    throw new MatchReportError("FORBIDDEN", "Viewers cannot create match reports");
  }

  const submittedAt = new Date();
  const report = command.report;
  try {
    const match = await db.$transaction(async (tx) => {
      const date = validateReport(report, await visibleEvidenceIds(tx, report));
      const created = await tx.match.create({
        data: {
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          tournament: report.tournament.trim(),
          roundNumber: report.roundNumber.trim() || null,
          opponent: report.opponent.trim(),
          topic: report.topic.trim(),
          format: formatToPrisma[report.format] ?? "PF",
          side: sideToPrisma[report.side] ?? "GENERIC",
          result: resultToPrisma[report.result] ?? "PENDING",
          judge: report.judge.trim() || null,
          date,
          tagsJson: report.tags.map((tag) => tag.trim()).filter(Boolean),
          reportSubmittedAt: submittedAt,
          reportRevision: 1,
          reflection: { create: report.reflection },
          argumentOutcomes: {
            create: report.argumentOutcomes.map((outcome, position) => ({
              position,
              argument: outcome.argument.trim(),
              side: sideToPrisma[outcome.side] ?? "GENERIC",
              category: outcome.category.trim() || "general",
              outcome: outcomeToPrisma[outcome.outcome],
              confidence: outcome.confidence,
              notes: outcome.notes
            }))
          },
          evidence: {
            create: report.evidence.map((evidence) => ({
              evidenceId: evidence.evidenceId,
              speechType: evidence.speechType?.trim() || null,
              effectivenessRating: evidence.effectivenessRating,
              notes: evidence.notes
            }))
          }
        }
      });
      await tx.auditLog.create({
        data: {
          workspaceId: actor.workspaceId,
          actorUserId: actor.userId,
          actorName: membership.user.name,
          action: "match_report.submitted",
          targetType: "Match",
          targetId: created.id,
          metaJson: { changeType: "submitted" }
        }
      });
      return created;
    });

    return {
      matchId: match.id,
      reportRevision: match.reportRevision,
      reportSubmittedAt: submittedAt.toISOString(),
      created: true
    };
  } catch (error) {
    normalizeWriteError(error);
  }
}
