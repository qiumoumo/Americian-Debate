import { db } from "@debate/db";
import type { FlowColumn, PracticeSessionSummary } from "@debate/shared";
import { mapDocument, mapEvidence, mapFlowRow, mapLibraryRound, mapMatch, mapPrismaFormat, mapPrismaSide, readStringArray } from "@/lib/mappers";

export async function getDocumentsForWorkspace(workspaceId: string) {
  const documents = await db.document.findMany({
    where: { workspaceId, deletedAt: null },
    include: { evidence: { orderBy: { createdAt: "desc" } } },
    orderBy: { updatedAt: "desc" }
  });

  return documents.map(mapDocument);
}

export async function getEvidenceForWorkspace(workspaceId: string) {
  const evidence = await db.evidence.findMany({
    where: { document: { workspaceId, deletedAt: null } },
    include: { document: true },
    orderBy: { updatedAt: "desc" }
  });

  return evidence.map(mapEvidence);
}

/** 已关联到某场比赛的 evidence id 列表（用于 library 面板标记「已加入」）。 */
export async function getMatchEvidenceIds(matchId: string, workspaceId: string) {
  const links = await db.matchEvidence.findMany({
    where: { matchId, match: { workspaceId, deletedAt: null } },
    select: { evidenceId: true }
  });
  return links.map((link) => link.evidenceId);
}

// ── Round Library（素材库）：workspace 共享 round + 当前用户私有笔记 ──
export async function getLibraryRoundsForWorkspace(workspaceId: string, userId: string) {
  const rounds = await db.libraryRound.findMany({
    where: { workspaceId, deletedAt: null },
    include: {
      // 一次带出当前用户的笔记，避免 N+1；NULL 时间戳排在前。
      notes: { where: { userId }, orderBy: [{ timestampSeconds: "asc" }, { createdAt: "asc" }] }
    },
    orderBy: { updatedAt: "desc" }
  });
  return rounds.map(mapLibraryRound);
}

export async function getLibraryRoundById(roundId: string, workspaceId: string, userId: string) {
  const round = await db.libraryRound.findFirst({
    where: { id: roundId, workspaceId, deletedAt: null },
    include: {
      notes: { where: { userId }, orderBy: [{ timestampSeconds: "asc" }, { createdAt: "asc" }] }
    }
  });
  return round ? mapLibraryRound(round) : null;
}

export async function getMatchesForWorkspace(workspaceId: string) {
  const matches = await db.match.findMany({
    where: { workspaceId, deletedAt: null },
    include: {
      reflection: true,
      argumentOutcomes: { orderBy: { createdAt: "desc" } }
    },
    orderBy: { updatedAt: "desc" }
  });

  return matches.map(mapMatch);
}

export async function getLatestMatchWorkspace(workspaceId: string) {
  return db.match.findFirst({
    where: { workspaceId, deletedAt: null },
    include: {
      speechNotes: { orderBy: { speechOrder: "asc" } },
      notes: { orderBy: { createdAt: "desc" } }
    },
    orderBy: { updatedAt: "desc" }
  });
}

export async function getMatchById(matchId: string, workspaceId: string) {
  return db.match.findFirst({
    where: { id: matchId, workspaceId, deletedAt: null },
    include: {
      speechNotes: { orderBy: { speechOrder: "asc" } },
      notes: { orderBy: { createdAt: "desc" } }
    }
  });
}

export async function getFlowForMatch(matchId: string, workspaceId: string) {
  const match = await db.match.findFirst({
    where: { id: matchId, workspaceId, deletedAt: null },
    include: {
      speechNotes: { orderBy: { speechOrder: "asc" } },
      flowRows: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: { cells: { orderBy: { speechOrder: "asc" }, include: { responses: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] } } } }
      }
    }
  });

  if (!match) {
    return { columns: [] as FlowColumn[], rows: [] };
  }

  const columns: FlowColumn[] = match.speechNotes
    .filter((note) => note.flowable)
    .map((note) => ({
      speechType: note.speechType,
      speechOrder: note.speechOrder,
      label: note.speechType
    }));

  return {
    columns,
    rows: match.flowRows.map(mapFlowRow)
  };
}

export async function getPracticeSummaries(userId: string, workspaceId?: string): Promise<PracticeSessionSummary[]> {
  const sessions = await db.practiceSession.findMany({
    where: { userId, ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return sessions.map((session) => {
    const score = typeof session.scoreJson === "object" && session.scoreJson && "score" in session.scoreJson
      ? Number((session.scoreJson as { score?: unknown }).score ?? 0)
      : 0;
    const feedback = typeof session.scoreJson === "object" && session.scoreJson && "feedback" in session.scoreJson
      ? String((session.scoreJson as { feedback?: unknown }).feedback ?? "No feedback yet.")
      : "No feedback yet.";

    return {
      id: session.id,
      topic: session.topic,
      format: mapPrismaFormat(session.format),
      side: mapPrismaSide(session.side),
      mode: session.mode,
      score,
      feedback,
      createdAt: session.createdAt.toISOString(),
      turns: readTranscript(session.transcriptJson).filter((turn) => turn.role === "user").length
    };
  });
}

export async function getPracticeSession(sessionId: string, userId: string, workspaceId?: string) {
  return db.practiceSession.findFirst({
    where: { id: sessionId, userId, ...(workspaceId ? { workspaceId } : {}) }
  });
}

export function readTranscript(value: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      return [{ role, content }];
    }
    return [];
  });
}

export function readRubricFocus(value: unknown): string[] {
  const fallback = ["clash", "evidence extension", "weighing", "strategic collapse"];
  const parsed = readStringArray(value).map((item) => item.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

/** Reads the rolling conversation summary stored on a practice session. */
export function readPracticeSummary(value: unknown): { summary: string; coveredTurns: number } {
  if (!value || typeof value !== "object") {
    return { summary: "", coveredTurns: 0 };
  }
  const summary = typeof (value as { summary?: unknown }).summary === "string"
    ? (value as { summary: string }).summary
    : "";
  const coveredRaw = (value as { coveredTurns?: unknown }).coveredTurns;
  const coveredTurns = typeof coveredRaw === "number" && Number.isFinite(coveredRaw) && coveredRaw >= 0
    ? Math.floor(coveredRaw)
    : 0;
  return { summary, coveredTurns };
}

export interface StoredPracticeDrill {
  title: string;
  instructions: string;
  targetDimension: string;
  durationSeconds: number;
  promptText: string;
}

/** Reads persisted AI-generated drills from a practice session's drillsJson. */
export function readDrills(value: unknown): StoredPracticeDrill[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const item = entry as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title : "";
    const promptText = typeof item.promptText === "string" ? item.promptText : "";
    if (!title && !promptText) {
      return [];
    }
    const durationRaw = Number(item.durationSeconds);
    return [{
      title,
      instructions: typeof item.instructions === "string" ? item.instructions : "",
      targetDimension: typeof item.targetDimension === "string" ? item.targetDimension : "general",
      durationSeconds: Number.isFinite(durationRaw) ? durationRaw : 30,
      promptText
    }];
  });
}

export function computeMatchStats(matches: Awaited<ReturnType<typeof getMatchesForWorkspace>>) {
  const decided = matches.filter((match) => match.result !== "pending");
  const wins = decided.filter((match) => match.result === "win").length;
  const affPro = decided.filter((match) => match.side === "Aff" || match.side === "Pro");
  const negCon = decided.filter((match) => match.side === "Neg" || match.side === "Con");

  return {
    rounds: matches.length,
    winRate: decided.length ? Math.round((wins / decided.length) * 100) : 0,
    affWinRate: affPro.length ? Math.round((affPro.filter((match) => match.result === "win").length / affPro.length) * 100) : 0,
    negWinRate: negCon.length ? Math.round((negCon.filter((match) => match.result === "win").length / negCon.length) * 100) : 0,
    argumentOutcomeCount: matches.reduce((sum, match) => sum + match.argumentOutcomes.length, 0)
  };
}

export async function getWorkspaceMembers(workspaceId: string) {
  return db.membership.findMany({
    where: { workspaceId },
    include: { user: true },
    orderBy: { createdAt: "asc" }
  });
}

export async function getPendingInvitations(workspaceId: string) {
  return db.invitation.findMany({
    where: { workspaceId, acceptedAt: null },
    orderBy: { createdAt: "desc" }
  });
}

export async function getAdminDashboard(workspaceId: string) {
  const memberships = await db.membership.findMany({ where: { workspaceId }, include: { user: true }, orderBy: { createdAt: "asc" } });
  const memberUserIds = memberships.map((membership) => membership.userId);
  const [documentCount, evidenceCount, matchCount, practiceCount, aiLogs, unresolvedSources] = await Promise.all([
    db.document.count({ where: { workspaceId, deletedAt: null } }),
    db.evidence.count({ where: { document: { workspaceId, deletedAt: null } } }),
    db.match.count({ where: { workspaceId, deletedAt: null } }),
    db.practiceSession.count({ where: { userId: { in: memberUserIds } } }),
    db.aIRequestLog.findMany({
      where: { userId: { in: memberUserIds }, OR: [{ source: null }, { source: { not: "personal" } }] },
      orderBy: { createdAt: "desc" },
      take: 10
    }),
    db.evidence.count({ where: { document: { workspaceId, deletedAt: null }, sourceUrl: "" } })
  ]);

  return {
    memberships,
    counts: { documentCount, evidenceCount, matchCount, practiceCount, unresolvedSources },
    aiLogs
  };
}

export async function getAdminWorkspaces(userId: string) {
  const memberships = await db.membership.findMany({
    where: { userId, role: { in: ["OWNER", "COACH"] }, workspace: { deletedAt: null } },
    include: {
      workspace: {
        include: {
          _count: { select: { memberships: true, documents: true, matches: true } }
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  return memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    role: m.role,
    memberCount: m.workspace._count.memberships,
    documentCount: m.workspace._count.documents,
    matchCount: m.workspace._count.matches
  }));
}

export async function getAnalyticsDashboard(workspaceId: string, memberUserIds: string[]) {
  const matches = await getMatchesForWorkspace(workspaceId);
  const stats = computeMatchStats(matches);

  // AI usage aggregated by taskType (workspace/env only — personal excluded).
  const aiLogs = await db.aIRequestLog.findMany({
    where: { userId: { in: memberUserIds }, OR: [{ source: null }, { source: { not: "personal" } }] },
    orderBy: { createdAt: "desc" },
    take: 500
  });

  const usageByTask = new Map<string, { count: number; inTokens: number; outTokens: number; cents: number }>();
  for (const log of aiLogs) {
    const entry = usageByTask.get(log.taskType) ?? { count: 0, inTokens: 0, outTokens: 0, cents: 0 };
    entry.count += 1;
    entry.inTokens += log.inputTokenEstimate;
    entry.outTokens += log.outputTokenEstimate;
    entry.cents += log.costEstimateCents;
    usageByTask.set(log.taskType, entry);
  }

  // Practice volume per member (top rows).
  const practiceByUser = await db.practiceSession.groupBy({
    by: ["userId"],
    where: { userId: { in: memberUserIds } },
    _count: { _all: true }
  });

  return {
    stats,
    matchCount: matches.length,
    aiUsage: Array.from(usageByTask.entries()).map(([taskType, value]) => ({ taskType, ...value })),
    totalAiRequests: aiLogs.length,
    totalAiCents: aiLogs.reduce((sum, log) => sum + log.costEstimateCents, 0),
    practiceTotal: practiceByUser.reduce((sum, row) => sum + row._count._all, 0)
  };
}

export function tagsToJson(tags: string) {
  return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
}

export { mapEvidence, readStringArray };
