import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const databaseFileName = `rooms-integration-${process.pid}.db`;
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
const rooms = await import("./rooms.ts");
const data = await import("./data.ts");
const { hasSystemAdminAccess } = await import("./admin-policy.ts");

async function createUserFixture(label: string) {
  const user = await db.user.create({ data: { email: `${label}@test.local`, name: label } });
  const workspace = await db.workspace.create({ data: { name: `${label} workspace` } });
  await db.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" } });
  return { user, workspace };
}

async function createMatchFixture(owner: Awaited<ReturnType<typeof createUserFixture>>, suffix: string) {
  const match = await db.match.create({
    data: { workspaceId: owner.workspace.id, userId: owner.user.id, tournament: `Tournament ${suffix}`, opponent: "Opponent", topic: "Topic", format: "PF", side: "AFF", tagsJson: [] }
  });
  const room = await rooms.createRoomForMatch(match.id, owner.user.id, match.format);
  return { match, room };
}

before(async () => {
  await db.roomInvitation.deleteMany();
});

after(async () => {
  await db.$disconnect();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-journal`, { force: true });
});

describe("room membership interface", () => {
  it("prevents a removed member from rejoining with the old code", async () => {
    const owner = await createUserFixture("owner-remove");
    const guest = await createUserFixture("guest-remove");
    const { match, room } = await createMatchFixture(owner, "remove");
    await rooms.joinRoomByCode(room.inviteCode, guest.user.id);
    await rooms.setRoomMemberStatus(match.id, guest.user.id, owner.user.id, "REMOVED");
    await assert.rejects(rooms.joinRoomByCode(room.inviteCode, guest.user.id), /removed/);
    await rooms.setRoomMemberStatus(match.id, guest.user.id, owner.user.id, "ACTIVE");
    assert.equal((await rooms.joinRoomByCode(room.inviteCode, guest.user.id)).matchId, match.id);
  });

  it("displaces the old room connection when a user enters another room", async () => {
    const owner = await createUserFixture("owner-presence");
    const first = await createMatchFixture(owner, "first");
    const second = await createMatchFixture(owner, "second");
    const oldConnection = await rooms.enterRoom(first.match.id, owner.user.id);
    const newConnection = await rooms.enterRoom(second.match.id, owner.user.id);
    assert.equal(await rooms.heartbeatRoom(oldConnection.roomId, owner.user.id, oldConnection.connectionToken), false);
    assert.equal(await rooms.heartbeatRoom(newConnection.roomId, owner.user.id, newConnection.connectionToken), true);
  });

  it("accepts an online invitation once and rejects a repeated response", async () => {
    const owner = await createUserFixture("owner-invite");
    const guest = await createUserFixture("guest-invite");
    const { match } = await createMatchFixture(owner, "invite");
    await db.session.create({ data: { token: "guest-online-token", userId: guest.user.id, workspaceId: guest.workspace.id, kind: "user", expiresAt: new Date(Date.now() + 60_000) } });
    const invitation = await rooms.inviteUserToRoom(match.id, guest.user.id, owner.user.id);
    assert.equal(await rooms.respondToRoomInvitation(invitation.id, guest.user.id, true), match.id);
    await assert.rejects(rooms.respondToRoomInvitation(invitation.id, guest.user.id, false), /no longer available/);
  });

  it("rejects offline invitations and ownership transfers", async () => {
    const owner = await createUserFixture("owner-offline");
    const guest = await createUserFixture("guest-offline");
    const { match, room } = await createMatchFixture(owner, "offline");
    await rooms.joinRoomByCode(room.inviteCode, guest.user.id);
    await assert.rejects(rooms.inviteUserToRoom(match.id, guest.user.id, owner.user.id), /no longer online/);
    await assert.rejects(rooms.transferRoomOwnership(match.id, guest.user.id, owner.user.id), /currently be online/);
    await rooms.enterRoom(match.id, guest.user.id);
    await rooms.transferRoomOwnership(match.id, guest.user.id, owner.user.id);
    assert.equal((await rooms.getRoomDetails(match.id, guest.user.id)).ownerId, guest.user.id);
  });

  it("enforces unique invite codes at the persistence seam", async () => {
    const owner = await createUserFixture("owner-code");
    const first = await createMatchFixture(owner, "code-first");
    const secondMatch = await db.match.create({ data: { workspaceId: owner.workspace.id, userId: owner.user.id, tournament: "Second", opponent: "Opponent", topic: "Topic", tagsJson: [] } });
    await assert.rejects(db.matchRoom.create({ data: { matchId: secondMatch.id, ownerId: owner.user.id, inviteCode: first.room.inviteCode, timerStateJson: {} } }));
  });

  it("limits system administration to explicitly authorized users", async () => {
    assert.equal(hasSystemAdminAccess({ isSystemAdmin: false }), false);
    assert.equal(hasSystemAdminAccess({ isSystemAdmin: true }), true);
  });

  it("lists only rooms with fresh presence", async () => {
    const owner = await createUserFixture("owner-active-list");
    const active = await createMatchFixture(owner, "active-list");
    const inactive = await createMatchFixture(owner, "inactive-list");
    await rooms.enterRoom(active.match.id, owner.user.id);
    const listed = await rooms.listActiveRooms();
    assert.ok(listed.some((room) => room.id === active.room.id));
    assert.ok(!listed.some((room) => room.id === inactive.room.id));
  });

  it("persists and advances the shared timer from server time", async () => {
    const owner = await createUserFixture("owner-timer");
    const { match } = await createMatchFixture(owner, "timer");
    const snapshot = await rooms.getRoomSnapshot(match.id, owner.user.id);
    await rooms.updateRoomTimer(match.id, owner.user.id, { ...snapshot.timer, remainingMs: 10, running: true }, Date.now() - 50);
    const advanced = await rooms.getRoomSnapshot(match.id, owner.user.id);
    assert.equal(advanced.timer.running, false);
    assert.equal(advanced.timer.speechIndex, 1);
  });

  it("returns global Evidence with the viewer's cross-workspace cards first", async () => {
    const viewer = await createUserFixture("evidence-viewer");
    const other = await createUserFixture("evidence-other");
    const viewerDocument = await db.document.create({ data: { workspaceId: viewer.workspace.id, ownerId: viewer.user.id, title: "Viewer", contentJson: {} } });
    const otherDocument = await db.document.create({ data: { workspaceId: other.workspace.id, ownerId: other.user.id, title: "Other", contentJson: {} } });
    await db.evidence.create({ data: { documentId: otherDocument.id, title: "Other newer", claim: "Other", quote: "Quote", sourceUrl: "https://example.com/other", tagsJson: [], contentRange: {} } });
    await db.evidence.create({ data: { documentId: viewerDocument.id, title: "Mine", claim: "Mine", quote: "Quote", sourceUrl: "https://example.com/mine", tagsJson: [], contentRange: {} } });
    const evidence = await data.getEvidenceForWorkspace(viewer.workspace.id, viewer.user.id);
    assert.equal(evidence[0]?.title, "Mine");
    assert.ok(evidence.some((card) => card.title === "Other newer" && card.uploaderName === other.user.name && !card.isMine));
  });
});
