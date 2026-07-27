import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { rmSync, writeFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const databaseFileName = `workspace-export-integration-${process.pid}.db`;
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
const { buildWorkspaceExport } = await import("./workspace-export.ts");

after(async () => {
  await db.$disconnect();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-journal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
});

describe("workspace export", () => {
  it("includes match evidence ratings and notes", async () => {
    const user = await db.user.create({ data: { email: "export@test.local", name: "Export Owner" } });
    const workspace = await db.workspace.create({ data: { name: "Export Workspace" } });
    await db.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" } });
    const document = await db.document.create({
      data: { workspaceId: workspace.id, ownerId: user.id, title: "Export document", contentJson: {} }
    });
    const evidence = await db.evidence.create({
      data: {
        documentId: document.id,
        title: "Export evidence",
        claim: "Export claim",
        quote: "Export quote",
        sourceUrl: "https://example.com/export",
        tagsJson: [],
        contentRange: {}
      }
    });
    const match = await db.match.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        tournament: "Export Open",
        opponent: "Opponent",
        topic: "Export topic",
        tagsJson: []
      }
    });
    await db.matchEvidence.create({
      data: {
        matchId: match.id,
        evidenceId: evidence.id,
        speechType: "Summary",
        effectivenessRating: 5,
        notes: "Judge cited this card"
      }
    });

    const exported = await buildWorkspaceExport(workspace.id, workspace.name);
    const exportedMatch = exported.matches.find((item) => item.id === match.id);
    assert.deepEqual(exportedMatch?.evidence.map((item) => ({
      evidenceId: item.evidenceId,
      speechType: item.speechType,
      effectivenessRating: item.effectivenessRating,
      notes: item.notes
    })), [{
      evidenceId: evidence.id,
      speechType: "Summary",
      effectivenessRating: 5,
      notes: "Judge cited this card"
    }]);
  });
});
