import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const databaseFileName = `documents-integration-${process.pid}.db`;
const databasePath = resolve(process.cwd(), "../../prisma", databaseFileName);
process.env.DATABASE_URL = `file:./${databaseFileName}`;
writeFileSync(databasePath, "");

const dbPackageDirectory = resolve(process.cwd(), "../../packages/db");
const pushed = spawnSync(process.execPath, ["src/prisma-cli.mjs", "db", "push", "--skip-generate"], {
  cwd: dbPackageDirectory,
  env: process.env,
  encoding: "utf8"
});
if (pushed.status !== 0) throw new Error(pushed.stderr || pushed.stdout);

const { db } = await import("@debate/db");
const documents = await import("./documents.ts");

async function createWorkspaceFixture(label: string) {
  const workspace = await db.workspace.create({ data: { name: `${label} workspace` } });
  async function addUser(suffix: string, role: "OWNER" | "COACH" | "DEBATER" | "VIEWER", isSystemAdmin = false) {
    const user = await db.user.create({
      data: { email: `${label}-${suffix}@test.local`, name: `${label} ${suffix}`, isSystemAdmin }
    });
    await db.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role } });
    return { userId: user.id, workspaceId: workspace.id, role, isSystemAdmin };
  }
  return { workspace, addUser };
}

after(async () => {
  await db.$disconnect();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-journal`, { force: true });
});

describe("shared document service", () => {
  it("allows collaborators to save a document but keeps viewers read-only", async () => {
    const fixture = await createWorkspaceFixture("collaboration");
    const owner = await fixture.addUser("owner", "OWNER");
    const debater = await fixture.addUser("debater", "DEBATER");
    const viewer = await fixture.addUser("viewer", "VIEWER");
    const document = await documents.createDocumentRecord(owner, { title: "Original", description: "Draft" });

    await documents.saveDocumentRecord(debater, document.id, {
      title: "Shared revision",
      description: "Updated together",
      content: "New case text"
    });
    const saved = await documents.getDocumentRecord(debater, document.id);
    assert.equal(saved.title, "Shared revision");
    assert.equal(saved.contentText, "New case text");

    await assert.rejects(
      documents.saveDocumentRecord(viewer, document.id, { title: "Viewer edit", description: "", content: "" }),
      /只读/
    );
  });

  it("limits soft deletion to the creator, coaches, owners, and system administrators", async () => {
    const fixture = await createWorkspaceFixture("deletion");
    const owner = await fixture.addUser("owner", "OWNER");
    const creator = await fixture.addUser("creator", "DEBATER");
    const otherDebater = await fixture.addUser("other", "DEBATER");
    const coach = await fixture.addUser("coach", "COACH");
    const administrator = await fixture.addUser("administrator", "DEBATER", true);

    const denied = await documents.createDocumentRecord(creator, { title: "Denied", description: "" });
    await assert.rejects(documents.softDeleteDocumentRecord(otherDebater, denied.id), /权限/);
    await documents.softDeleteDocumentRecord(coach, denied.id);

    const ownerDeleted = await documents.createDocumentRecord(creator, { title: "Owner deletes", description: "" });
    await documents.softDeleteDocumentRecord(owner, ownerDeleted.id);
    const adminDeleted = await documents.createDocumentRecord(creator, { title: "Admin deletes", description: "" });
    await documents.softDeleteDocumentRecord(administrator, adminDeleted.id);
    const creatorDeleted = await documents.createDocumentRecord(creator, { title: "Creator deletes", description: "" });
    await documents.softDeleteDocumentRecord(creator, creatorDeleted.id);

    assert.equal(await db.document.count({ where: { deletedAt: { not: null } } }), 4);
  });

  it("rejects every operation against a document in another workspace", async () => {
    const first = await createWorkspaceFixture("first");
    const second = await createWorkspaceFixture("second");
    const firstOwner = await first.addUser("owner", "OWNER");
    const secondOwner = await second.addUser("owner", "OWNER");
    const document = await documents.createDocumentRecord(firstOwner, { title: "Private workspace", description: "" });

    await assert.rejects(documents.getDocumentRecord(secondOwner, document.id), /不属于当前工作区/);
    await assert.rejects(
      documents.saveDocumentRecord(secondOwner, document.id, { title: "Cross workspace", description: "", content: "" }),
      /不属于当前工作区/
    );
    await assert.rejects(documents.softDeleteDocumentRecord(secondOwner, document.id), /不属于当前工作区/);
  });
});
