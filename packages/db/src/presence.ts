import type { PrismaClient } from "@prisma/client";

export async function normalizeLegacySessionTimestamps(client: Pick<PrismaClient, "$executeRawUnsafe">) {
  return client.$executeRawUnsafe(
    `UPDATE "Session" SET "lastSeenAt" = 0 WHERE typeof("lastSeenAt") = 'text'`
  );
}
