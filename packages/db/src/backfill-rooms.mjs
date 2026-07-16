import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { loadLocalEnv } from "./load-env.mjs";
import { createInitialSharedTimer } from "../../shared/src/index.ts";
import { normalizeLegacySessionTimestamps } from "./presence.ts";

loadLocalEnv();
const prisma = new PrismaClient();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function code() {
  return Array.from(randomBytes(6), (value) => alphabet[value % alphabet.length]).join("");
}

async function uniqueCode() {
  while (true) {
    const inviteCode = code();
    if (!await prisma.matchRoom.findUnique({ where: { inviteCode }, select: { id: true } })) return inviteCode;
  }
}

async function main() {
  const normalizedSessions = await normalizeLegacySessionTimestamps(prisma);
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim() || "admin@debate.local";
  await prisma.user.updateMany({ where: { email: adminEmail }, data: { isSystemAdmin: true } });
  const matches = await prisma.match.findMany({ where: { room: null, deletedAt: null }, select: { id: true, userId: true, format: true } });
  for (const match of matches) {
    await prisma.matchRoom.create({
      data: {
        matchId: match.id,
        ownerId: match.userId,
        inviteCode: await uniqueCode(),
        timerStateJson: createInitialSharedTimer(match.format === "POLICY" ? "Policy" : match.format === "CUSTOM" ? "Custom" : match.format),
        members: { create: { userId: match.userId } }
      }
    });
  }
  console.log(`Backfilled ${matches.length} match room(s); normalized ${normalizedSessions} legacy session timestamp(s).`);
}

main().finally(() => prisma.$disconnect());
