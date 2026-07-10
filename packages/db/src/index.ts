import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function parseEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function findRepoRoot(startDir: string) {
  let current = startDir;
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

function loadLocalEnv() {
  const repoRoot = findRepoRoot(process.cwd());
  parseEnvFile(path.join(repoRoot, ".env.local"));
  parseEnvFile(path.join(repoRoot, ".env"));

  process.env.AI_PROVIDER ??= "mock";
  process.env.DATABASE_URL ??= "file:./dev-mvp.db";
}

loadLocalEnv();

export const databasePlan = {
  localProvider: "sqlite",
  cloudProvider: "postgresql",
  syncReadyFields: ["workspaceId", "ownerId", "createdAt", "updatedAt", "deletedAt"]
} as const;

export type DatabasePlan = typeof databasePlan;

const globalForPrisma = globalThis as unknown as { debatePrisma?: PrismaClient };

export const db = globalForPrisma.debatePrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.debatePrisma = db;
}

export * from "@prisma/client";
