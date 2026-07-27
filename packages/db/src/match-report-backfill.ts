import { db } from "./index.ts";

export async function backfillLegacyMatchReports(client = db) {
  const matches = await client.match.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      result: true,
      updatedAt: true,
      reportSubmittedAt: true,
      reportRevision: true,
      reflection: { select: { id: true } },
      argumentOutcomes: {
        select: { id: true, position: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      },
      evidence: {
        where: {
          OR: [
            { effectivenessRating: { not: null } },
            { notes: { not: "" } }
          ]
        },
        select: { id: true },
        take: 1
      }
    },
    orderBy: { id: "asc" }
  });

  let submitted = 0;
  let positioned = 0;

  for (const match of matches) {
    const hasLegacyReport = match.result !== "PENDING"
      || Boolean(match.reflection)
      || match.argumentOutcomes.length > 0
      || match.evidence.length > 0;

    const changes = await client.$transaction(async (tx) => {
      let positionedForMatch = 0;
      for (const [position, outcome] of match.argumentOutcomes.entries()) {
        if (outcome.position === position) continue;
        const updated = await tx.argumentOutcome.updateMany({
          where: { id: outcome.id, matchId: match.id, position: outcome.position },
          data: { position }
        });
        positionedForMatch += updated.count;
      }

      if (!hasLegacyReport || (match.reportSubmittedAt && match.reportRevision >= 1)) {
        return { positioned: positionedForMatch, submitted: 0 };
      }
      const updated = await tx.match.updateMany({
        where: {
          id: match.id,
          reportSubmittedAt: match.reportSubmittedAt,
          reportRevision: match.reportRevision,
          updatedAt: match.updatedAt
        },
        data: {
          reportSubmittedAt: match.reportSubmittedAt ?? match.updatedAt,
          reportRevision: Math.max(1, match.reportRevision)
        }
      });
      return {
        positioned: positionedForMatch,
        submitted: match.reportSubmittedAt ? 0 : updated.count
      };
    });
    positioned += changes.positioned;
    submitted += changes.submitted;
  }

  return { processed: matches.length, submitted, positioned };
}
