import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { rmSync, writeFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const databaseFileName = `match-report-backfill-integration-${process.pid}.db`;
const databasePath = resolve(process.cwd(), "../../prisma", databaseFileName);
process.env.DATABASE_URL = `file:./${databaseFileName}`;
process.env.PATH = `${resolve(process.cwd(), "../../node_modules/.bin")}${delimiter}${process.env.PATH ?? ""}`;
writeFileSync(databasePath, "");

const dbPackageDirectory = resolve(process.cwd(), "../../packages/db");
const pushed = spawnSync(process.execPath, ["src/prisma-cli.mjs", "db", "push", "--skip-generate"], {
  cwd: dbPackageDirectory,
  env: process.env,
  encoding: "utf8"
});
if (pushed.status !== 0) throw new Error(pushed.stderr || pushed.stdout);

const { db } = await import("@debate/db");
const { backfillLegacyMatchReports } = await import("@debate/db/match-report-backfill");
const { getMatchReport } = await import("./match-reports.ts");

after(async () => {
  await db.$disconnect();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-journal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
});

describe("legacy match report backfill", () => {
  it("backfills every legacy report signal once and preserves pre-match records", async () => {
    const user = await db.user.create({ data: { email: "backfill@test.local", name: "Backfill Owner" } });
    const workspace = await db.workspace.create({ data: { name: "Backfill Workspace" } });
    await db.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" } });
    const actor = { userId: user.id, workspaceId: workspace.id };

    const createMatch = (label: string, result: "PENDING" | "WIN" = "PENDING") => db.match.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        tournament: label,
        opponent: "Opponent",
        topic: `${label} topic`,
        result,
        tagsJson: []
      }
    });

    const decided = await createMatch("Decided legacy", "WIN");
    const reflected = await createMatch("Reflected legacy");
    await db.reflection.create({ data: { matchId: reflected.id, whatWorked: "Clear weighing" } });

    const argued = await createMatch("Argument legacy");
    await db.argumentOutcome.createMany({
      data: [
        { matchId: argued.id, argument: "First", side: "AFF", outcome: "WON", createdAt: new Date("2026-01-01T00:00:01.000Z") },
        { matchId: argued.id, argument: "Second", side: "NEG", outcome: "LOST", createdAt: new Date("2026-01-01T00:00:02.000Z") },
        { matchId: argued.id, argument: "Third", side: "AFF", outcome: "TURNED", createdAt: new Date("2026-01-01T00:00:03.000Z") }
      ]
    });

    const evidenced = await createMatch("Evidence legacy");
    const document = await db.document.create({
      data: { workspaceId: workspace.id, ownerId: user.id, title: "Legacy evidence", contentJson: {} }
    });
    const evidence = await db.evidence.create({
      data: {
        documentId: document.id,
        title: "Legacy card",
        claim: "Legacy claim",
        quote: "Legacy quote",
        sourceUrl: "https://example.com/legacy",
        tagsJson: [],
        contentRange: {}
      }
    });
    await db.matchEvidence.create({
      data: { matchId: evidenced.id, evidenceId: evidence.id, effectivenessRating: 4 }
    });

    const untouched = await createMatch("Pre-match only");

    const first = await backfillLegacyMatchReports();
    assert.deepEqual(first, { processed: 5, submitted: 4, positioned: 2 });

    for (const legacy of [decided, reflected, argued, evidenced]) {
      const report = await getMatchReport(actor, legacy.id);
      assert.equal(report.reportSubmittedAt, legacy.updatedAt.toISOString());
      assert.equal(report.reportRevision, 1);
    }
    assert.deepEqual(
      (await getMatchReport(actor, argued.id)).argumentOutcomes.map((outcome) => [outcome.position, outcome.argument]),
      [[0, "First"], [1, "Second"], [2, "Third"]]
    );

    const pending = await getMatchReport(actor, untouched.id);
    assert.equal(pending.reportSubmittedAt, null);
    assert.equal(pending.reportRevision, 0);

    const second = await backfillLegacyMatchReports();
    assert.deepEqual(second, { processed: 5, submitted: 0, positioned: 0 });
    assert.equal((await getMatchReport(actor, decided.id)).reportSubmittedAt, decided.updatedAt.toISOString());
  });
});
