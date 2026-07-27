import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { rmSync, writeFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { MatchReportPayload } from "./match-reports.ts";

const databaseFileName = `match-reports-integration-${process.pid}.db`;
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
const reports = await import("./match-reports.ts");

async function createActorFixture(label: string, role: "OWNER" | "COACH" | "DEBATER" | "VIEWER" = "DEBATER") {
  const user = await db.user.create({ data: { email: `${label}@test.local`, name: label } });
  const workspace = await db.workspace.create({ data: { name: `${label} workspace` } });
  await db.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role } });
  return { user, workspace, actor: { userId: user.id, workspaceId: workspace.id } };
}

async function addWorkspaceActor(workspaceId: string, label: string, role: "OWNER" | "COACH" | "DEBATER" | "VIEWER") {
  const user = await db.user.create({ data: { email: `${label}@test.local`, name: label } });
  await db.membership.create({ data: { userId: user.id, workspaceId, role } });
  return { user, actor: { userId: user.id, workspaceId } };
}

function validReport(overrides: Partial<MatchReportPayload> = {}): MatchReportPayload {
  return {
    tournament: "Shanghai Invitational",
    roundNumber: "R3",
    opponent: "North High",
    topic: "Resolved: cities should restrict private cars",
    format: "PF",
    side: "Pro",
    result: "pending",
    judge: "Judge Chen",
    date: "2026-07-20",
    tags: ["summer", "varsity"],
    argumentOutcomes: [],
    evidence: [],
    reflection: { whatWorked: "", whatFailed: "", judgeFeedback: "", nextSteps: "" },
    ...overrides
  };
}

after(async () => {
  await db.$disconnect();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-journal`, { force: true });
});

describe("match report public seam", () => {
  it("creates a pending historical report without a match room and makes it retrievable", async () => {
    const fixture = await createActorFixture("historical-owner");

    const saved = await reports.saveMatchReport(fixture.actor, {
      target: { kind: "historical" },
      report: validReport()
    });
    const report = await reports.getMatchReport(fixture.actor, saved.matchId);

    assert.equal(saved.created, true);
    assert.equal(saved.reportRevision, 1);
    assert.equal(report.source, "historical");
    assert.equal(report.result, "pending");
    assert.equal(report.reportRevision, 1);
    assert.equal(report.tournament, "Shanghai Invitational");
  });

  it("persists an ordered argument, evidence, and reflection snapshot", async () => {
    const fixture = await createActorFixture("structured-owner");
    const document = await db.document.create({
      data: { workspaceId: fixture.workspace.id, ownerId: fixture.user.id, title: "Case file", contentJson: {} }
    });
    const evidence = await db.evidence.create({
      data: {
        documentId: document.id,
        title: "Transit card",
        claim: "Transit investment reduces congestion",
        quote: "Worked example",
        sourceUrl: "https://example.com/transit",
        side: "PRO",
        tagsJson: [],
        contentRange: {}
      }
    });

    const saved = await reports.saveMatchReport(fixture.actor, {
      target: { kind: "historical" },
      report: validReport({
        result: "win",
        argumentOutcomes: [
          { argument: "Accessibility", side: "Pro", category: "contention", outcome: "won", confidence: 5, notes: "Extended cleanly" },
          { argument: "Implementation cost", side: "Con", category: "response", outcome: "turned", confidence: 4, notes: "Turn became offense" }
        ],
        evidence: [{ evidenceId: evidence.id, speechType: "Summary", effectivenessRating: 5, notes: "Judge cited it" }],
        reflection: {
          whatWorked: "Clear weighing",
          whatFailed: "Slow crossfire",
          judgeFeedback: "Compare earlier",
          nextSteps: "Drill summaries"
        }
      })
    });
    const report = await reports.getMatchReport(fixture.actor, saved.matchId);

    assert.deepEqual(report.argumentOutcomes.map((outcome) => [outcome.position, outcome.argument, outcome.outcome]), [
      [0, "Accessibility", "won"],
      [1, "Implementation cost", "turned"]
    ]);
    assert.deepEqual(
      report.evidenceOptions.filter((option) => option.selected).map((option) => [option.evidenceId, option.effectivenessRating, option.notes]),
      [[evidence.id, 5, "Judge cited it"]]
    );
    assert.deepEqual(report.reflection, {
      whatWorked: "Clear weighing",
      whatFailed: "Slow crossfire",
      judgeFeedback: "Compare earlier",
      nextSteps: "Drill summaries"
    });
  });

  it("suggests flow rows for an unsubmitted room match and submits it at the expected revision", async () => {
    const fixture = await createActorFixture("room-owner");
    const match = await db.match.create({
      data: {
        workspaceId: fixture.workspace.id,
        userId: fixture.user.id,
        tournament: "Live tournament",
        opponent: "West High",
        topic: "Live topic",
        format: "LD",
        side: "AFF",
        tagsJson: [],
        flowRows: {
          create: [
            { title: "Value framework", category: "framework", side: "AFF", order: 0 },
            { title: "Rights contention", category: "case", side: "AFF", order: 1 }
          ]
        }
      }
    });
    await db.matchRoom.create({
      data: {
        matchId: match.id,
        ownerId: fixture.user.id,
        inviteCode: `ROOM${process.pid}`,
        timerStateJson: {},
        members: { create: { userId: fixture.user.id } }
      }
    });

    const before = await reports.getMatchReport(fixture.actor, match.id);
    assert.deepEqual(before.argumentOutcomes.map((outcome) => [outcome.argument, outcome.outcome, outcome.suggested]), [
      ["Value framework", null, true],
      ["Rights contention", null, true]
    ]);

    const saved = await reports.saveMatchReport(fixture.actor, {
      target: { kind: "existing", matchId: match.id, expectedRevision: 0 },
      report: validReport({
        tournament: "Live tournament",
        opponent: "West High",
        topic: "Live topic",
        format: "LD",
        side: "Aff",
        result: "loss",
        argumentOutcomes: [
          { argument: "Rights contention", side: "Aff", category: "case", outcome: "lost", confidence: 4, notes: "Under-covered" }
        ]
      })
    });
    const afterSave = await reports.getMatchReport(fixture.actor, match.id);

    assert.equal(saved.created, false);
    assert.equal(saved.reportRevision, 1);
    assert.equal(afterSave.reportRevision, 1);
    assert.ok(afterSave.reportSubmittedAt);
    assert.deepEqual(afterSave.argumentOutcomes.map((outcome) => [outcome.argument, outcome.suggested]), [["Rights contention", false]]);
  });

  it("replaces the full evidence snapshot on revision and rejects stale revisions", async () => {
    const fixture = await createActorFixture("revision-owner");
    const document = await db.document.create({
      data: { workspaceId: fixture.workspace.id, ownerId: fixture.user.id, title: "Revision evidence", contentJson: {} }
    });
    const firstEvidence = await db.evidence.create({
      data: { documentId: document.id, title: "First card", claim: "First", quote: "First quote", sourceUrl: "https://example.com/first", tagsJson: [], contentRange: {} }
    });
    const secondEvidence = await db.evidence.create({
      data: { documentId: document.id, title: "Second card", claim: "Second", quote: "Second quote", sourceUrl: "https://example.com/second", tagsJson: [], contentRange: {} }
    });
    const initial = await reports.saveMatchReport(fixture.actor, {
      target: { kind: "historical" },
      report: validReport({ evidence: [{ evidenceId: firstEvidence.id, effectivenessRating: 2, notes: "Weak" }] })
    });

    const revised = await reports.saveMatchReport(fixture.actor, {
      target: { kind: "existing", matchId: initial.matchId, expectedRevision: 1 },
      report: validReport({
        tournament: "Revised tournament",
        evidence: [{ evidenceId: secondEvidence.id, effectivenessRating: 5, notes: "Decisive" }]
      })
    });
    const afterRevision = await reports.getMatchReport(fixture.actor, initial.matchId);

    assert.equal(revised.reportRevision, 2);
    assert.equal(revised.reportSubmittedAt, initial.reportSubmittedAt);
    assert.deepEqual(
      afterRevision.evidenceOptions.filter((option) => option.selected).map((option) => [option.evidenceId, option.effectivenessRating]),
      [[secondEvidence.id, 5]]
    );

    await assert.rejects(
      reports.saveMatchReport(fixture.actor, {
        target: { kind: "existing", matchId: initial.matchId, expectedRevision: 1 },
        report: validReport({ tournament: "Stale overwrite" })
      }),
      (error: unknown) => error instanceof reports.MatchReportError && error.code === "REVISION_CONFLICT"
    );
    const auditLogs = await db.auditLog.findMany({
      where: { targetType: "Match", targetId: initial.matchId },
      orderBy: { createdAt: "asc" },
      select: { action: true, metaJson: true }
    });
    assert.deepEqual(auditLogs, [
      { action: "match_report.submitted", metaJson: { changeType: "submitted" } },
      { action: "match_report.revised", metaJson: { changeType: "revised" } }
    ]);
    assert.ok(!JSON.stringify(auditLogs).includes("Decisive"));
    assert.equal((await reports.getMatchReport(fixture.actor, initial.matchId)).tournament, "Revised tournament");
  });

  it("returns typed validation issues and leaves the previous report unchanged", async () => {
    const fixture = await createActorFixture("validation-owner");
    const initial = await reports.saveMatchReport(fixture.actor, {
      target: { kind: "historical" },
      report: validReport({ tournament: "Stable tournament" })
    });
    const hiddenDocument = await db.document.create({
      data: {
        workspaceId: fixture.workspace.id,
        ownerId: fixture.user.id,
        title: "Deleted document",
        contentJson: {},
        deletedAt: new Date()
      }
    });
    const hiddenEvidence = await db.evidence.create({
      data: {
        documentId: hiddenDocument.id,
        title: "Hidden card",
        claim: "Hidden",
        quote: "Hidden quote",
        sourceUrl: "https://example.com/hidden",
        tagsJson: [],
        contentRange: {}
      }
    });

    await assert.rejects(
      reports.saveMatchReport(fixture.actor, {
        target: { kind: "existing", matchId: initial.matchId, expectedRevision: 1 },
        report: validReport({
          tournament: "   ",
          date: "not-a-date",
          argumentOutcomes: [
            { argument: "", side: "Aff", category: "case", outcome: "won", confidence: 6, notes: "" }
          ],
          evidence: [{ evidenceId: hiddenEvidence.id, effectivenessRating: 0, notes: "" }]
        })
      }),
      (error: unknown) => {
        assert.ok(error instanceof reports.MatchReportError);
        assert.equal(error.code, "VALIDATION_FAILED");
        assert.equal(error.issues.tournament, "Tournament is required");
        assert.equal(error.issues.date, "Date must be valid");
        assert.equal(error.issues["argumentOutcomes.0.confidence"], "Confidence must be between 1 and 5");
        assert.equal(error.issues["evidence.0.evidenceId"], "Evidence is not visible");
        return true;
      }
    );

    const unchanged = await reports.getMatchReport(fixture.actor, initial.matchId);
    assert.equal(unchanged.tournament, "Stable tournament");
    assert.equal(unchanged.reportRevision, 1);
  });

  it("lists submitted reports with stable filtering and excludes pending results from win-rate denominators", async () => {
    const fixture = await createActorFixture("history-owner", "OWNER");
    const viewer = await addWorkspaceActor(fixture.workspace.id, "history-viewer", "VIEWER");
    const transitWin = await reports.saveMatchReport(fixture.actor, {
      target: { kind: "historical" },
      report: validReport({
        tournament: "Metro Invitational",
        topic: "Transit access",
        side: "Pro",
        result: "win",
        date: "2026-07-20",
        argumentOutcomes: [
          { argument: "Access", side: "Pro", category: "case", outcome: "won", confidence: 5, notes: "" },
          { argument: "Cost", side: "Con", category: "response", outcome: "lost", confidence: 4, notes: "" }
        ]
      })
    });
    const pendingResult = await reports.saveMatchReport(fixture.actor, {
      target: { kind: "historical" },
      report: validReport({ tournament: "Housing Cup", topic: "Housing supply", side: "Con", result: "pending", date: "2026-07-19" })
    });
    const transitLoss = await reports.saveMatchReport(fixture.actor, {
      target: { kind: "historical" },
      report: validReport({
        tournament: "Regional",
        topic: "Transit funding",
        side: "Aff",
        result: "loss",
        date: "2026-07-18",
        argumentOutcomes: [
          { argument: "Federalism", side: "Neg", category: "offcase", outcome: "turned", confidence: 3, notes: "" }
        ]
      })
    });
    const unsubmitted = await db.match.create({
      data: {
        workspaceId: fixture.workspace.id,
        userId: fixture.user.id,
        tournament: "Upcoming round",
        opponent: "East High",
        topic: "Future topic",
        date: new Date("2026-07-21T00:00:00.000Z"),
        tagsJson: []
      }
    });

    const history = await reports.getMatchHistory(viewer.actor, {});
    assert.deepEqual(history.reports.map((item) => item.id), [transitWin.matchId, pendingResult.matchId, transitLoss.matchId]);
    assert.deepEqual(history.pending.map((item) => item.id), [unsubmitted.id]);
    assert.ok(history.reports.every((item) => item.canEdit === false));
    assert.deepEqual(history.stats, {
      rounds: 3,
      decidedRounds: 2,
      wins: 1,
      winRate: 50,
      affWinRate: 50,
      negWinRate: 0,
      argumentOutcomes: { total: 3, won: 1, lost: 1, dropped: 0, turned: 1, conceded: 0 }
    });

    const filtered = await reports.getMatchHistory(viewer.actor, {
      keyword: "transit",
      result: "win",
      side: "Pro",
      dateFrom: "2026-07-20",
      dateTo: "2026-07-20"
    });
    assert.deepEqual(filtered.reports.map((item) => item.id), [transitWin.matchId]);
    assert.equal(filtered.stats.rounds, 1);
    assert.equal(filtered.stats.winRate, 100);
  });

  it("returns visible evidence options with the saved selection state", async () => {
    const fixture = await createActorFixture("evidence-options-owner");
    const document = await db.document.create({
      data: { workspaceId: fixture.workspace.id, ownerId: fixture.user.id, title: "Visible cards", contentJson: {} }
    });
    const selected = await db.evidence.create({
      data: { documentId: document.id, title: "Selected", claim: "Selected claim", quote: "Selected quote", sourceUrl: "https://example.com/selected", tagsJson: [], contentRange: {} }
    });
    const available = await db.evidence.create({
      data: { documentId: document.id, title: "Available", claim: "Available claim", quote: "Available quote", sourceUrl: "https://example.com/available", tagsJson: [], contentRange: {} }
    });
    const deletedDocument = await db.document.create({
      data: { workspaceId: fixture.workspace.id, ownerId: fixture.user.id, title: "Deleted cards", contentJson: {}, deletedAt: new Date() }
    });
    const hidden = await db.evidence.create({
      data: { documentId: deletedDocument.id, title: "Hidden", claim: "Hidden claim", quote: "Hidden quote", sourceUrl: "https://example.com/hidden-option", tagsJson: [], contentRange: {} }
    });
    const saved = await reports.saveMatchReport(fixture.actor, {
      target: { kind: "historical" },
      report: validReport({ evidence: [{ evidenceId: selected.id, effectivenessRating: 4, notes: "Useful" }] })
    });

    const report = await reports.getMatchReport(fixture.actor, saved.matchId);
    const options = new Map(report.evidenceOptions.map((option) => [option.evidenceId, option]));
    assert.equal(options.get(selected.id)?.selected, true);
    assert.equal(options.get(selected.id)?.effectivenessRating, 4);
    assert.equal(options.get(available.id)?.selected, false);
    assert.equal(options.has(hidden.id), false);
  });

  it("requires every selected evidence card to have a 1-5 effectiveness rating", async () => {
    const fixture = await createActorFixture("evidence-rating-owner");
    const document = await db.document.create({
      data: { workspaceId: fixture.workspace.id, ownerId: fixture.user.id, title: "Rated cards", contentJson: {} }
    });
    const evidence = await db.evidence.create({
      data: { documentId: document.id, title: "Needs rating", claim: "Claim", quote: "Quote", sourceUrl: "https://example.com/rating", tagsJson: [], contentRange: {} }
    });

    await assert.rejects(
      reports.saveMatchReport(fixture.actor, {
        target: { kind: "historical" },
        report: validReport({ evidence: [{ evidenceId: evidence.id, effectivenessRating: null, notes: "" }] })
      }),
      (error: unknown) => {
        assert.ok(error instanceof reports.MatchReportError);
        assert.equal(error.code, "VALIDATION_FAILED");
        assert.equal(error.issues["evidence.0.effectivenessRating"], "Effectiveness must be between 1 and 5");
        return true;
      }
    );
    assert.equal((await reports.getMatchHistory(fixture.actor, {})).reports.length, 0);
  });

  it("enforces workspace roles and direct cross-workspace room access", async () => {
    const fixture = await createActorFixture("permission-owner", "OWNER");
    const coach = await addWorkspaceActor(fixture.workspace.id, "permission-coach", "COACH");
    const viewer = await addWorkspaceActor(fixture.workspace.id, "permission-viewer", "VIEWER");
    const guestFixture = await createActorFixture("permission-guest", "DEBATER");
    const match = await db.match.create({
      data: {
        workspaceId: fixture.workspace.id,
        userId: fixture.user.id,
        tournament: "Permission round",
        opponent: "Opponent",
        topic: "Permission topic",
        tagsJson: []
      }
    });
    const room = await db.matchRoom.create({
      data: {
        matchId: match.id,
        ownerId: fixture.user.id,
        inviteCode: `PERM${process.pid}`,
        timerStateJson: {},
        members: { create: [{ userId: fixture.user.id }, { userId: guestFixture.user.id }] }
      }
    });
    await reports.saveMatchReport(fixture.actor, {
      target: { kind: "existing", matchId: match.id, expectedRevision: 0 },
      report: validReport({ tournament: "Permission round", opponent: "Opponent", topic: "Permission topic" })
    });

    const guestView = await reports.getMatchReport(guestFixture.actor, match.id);
    assert.equal(guestView.access, "room");
    assert.equal(guestView.canEdit, false);
    assert.equal((await reports.getMatchHistory(guestFixture.actor, {})).reports.some((item) => item.id === match.id), false);

    await db.matchRoom.update({ where: { id: room.id }, data: { ownerId: guestFixture.user.id } });
    assert.equal((await reports.getMatchReport(guestFixture.actor, match.id)).canEdit, true);
    const guestRevision = await reports.saveMatchReport(guestFixture.actor, {
      target: { kind: "existing", matchId: match.id, expectedRevision: 1 },
      report: validReport({ tournament: "Guest host revision", opponent: "Opponent", topic: "Permission topic" })
    });
    assert.equal(guestRevision.reportRevision, 2);

    assert.equal((await reports.getMatchReport(coach.actor, match.id)).canEdit, true);
    const coachRevision = await reports.saveMatchReport(coach.actor, {
      target: { kind: "existing", matchId: match.id, expectedRevision: 2 },
      report: validReport({ tournament: "Coach revision", opponent: "Opponent", topic: "Permission topic" })
    });
    assert.equal(coachRevision.reportRevision, 3);
    assert.equal((await reports.getMatchReport(viewer.actor, match.id)).canEdit, false);
    await assert.rejects(
      reports.saveMatchReport(viewer.actor, {
        target: { kind: "existing", matchId: match.id, expectedRevision: 3 },
        report: validReport({ tournament: "Viewer overwrite", opponent: "Opponent", topic: "Permission topic" })
      }),
      (error: unknown) => error instanceof reports.MatchReportError && error.code === "FORBIDDEN"
    );

    await db.roomMember.update({
      where: { roomId_userId: { roomId: room.id, userId: guestFixture.user.id } },
      data: { status: "REMOVED" }
    });
    await assert.rejects(
      reports.getMatchReport(guestFixture.actor, match.id),
      (error: unknown) => error instanceof reports.MatchReportError && error.code === "FORBIDDEN"
    );
  });

  it("rolls back the whole report and hides database errors when a child write fails", async () => {
    const fixture = await createActorFixture("rollback-owner");
    const initial = await reports.saveMatchReport(fixture.actor, {
      target: { kind: "historical" },
      report: validReport({ tournament: "Before rollback" })
    });
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "match_report_force_outcome_failure"
      BEFORE INSERT ON "ArgumentOutcome"
      BEGIN
        SELECT RAISE(ABORT, 'forced outcome failure');
      END
    `);

    try {
      await assert.rejects(
        reports.saveMatchReport(fixture.actor, {
          target: { kind: "existing", matchId: initial.matchId, expectedRevision: 1 },
          report: validReport({
            tournament: "Must roll back",
            argumentOutcomes: [
              { argument: "Trigger outcome", side: "Pro", category: "case", outcome: "won", confidence: 3, notes: "" }
            ]
          })
        }),
        (error: unknown) => error instanceof reports.MatchReportError && error.code === "VALIDATION_FAILED"
      );
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "match_report_force_outcome_failure"');
    }

    const unchanged = await reports.getMatchReport(fixture.actor, initial.matchId);
    assert.equal(unchanged.tournament, "Before rollback");
    assert.equal(unchanged.reportRevision, 1);
    assert.deepEqual(unchanged.argumentOutcomes, []);
  });

  it("hides soft-deleted matches from both detail and workspace history", async () => {
    const fixture = await createActorFixture("soft-delete-owner");
    const saved = await reports.saveMatchReport(fixture.actor, {
      target: { kind: "historical" },
      report: validReport({ tournament: "Deleted report" })
    });
    await db.match.update({ where: { id: saved.matchId }, data: { deletedAt: new Date() } });

    await assert.rejects(
      reports.getMatchReport(fixture.actor, saved.matchId),
      (error: unknown) => error instanceof reports.MatchReportError && error.code === "NOT_FOUND"
    );
    assert.equal((await reports.getMatchHistory(fixture.actor, {})).reports.some((item) => item.id === saved.matchId), false);
  });
});
