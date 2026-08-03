import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const databaseFileName = `language-integration-${process.pid}.db`;
const databasePath = resolve(process.cwd(), "../../prisma", databaseFileName);
process.env.DATABASE_URL = `file:./${databaseFileName}`;
writeFileSync(databasePath, "");

const dbPackageDirectory = resolve(process.cwd(), "../../packages/db");
const prismaCli = resolve(dbPackageDirectory, "node_modules/prisma/build/index.js");
const pushed = spawnSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", "../../prisma/schema.prisma"], {
  cwd: dbPackageDirectory,
  env: process.env,
  encoding: "utf8"
});
if (pushed.status !== 0) throw new Error(pushed.stderr || pushed.stdout);

const { db } = await import("@debate/db");
const preferences = await import("./language-preferences.ts");

after(async () => {
  await db.$disconnect();
  rmSync(databasePath, { force: true });
});

describe("account language preference persistence", () => {
  it("stores the global mode and only valid module overrides", async () => {
    const user = await db.user.create({ data: { email: "language@test.local", name: "Language" } });
    await preferences.saveAccountLanguagePreferences(user.id, {
      globalMode: "zh-terms-en",
      overrides: { matches: "en", practice: "zh-CN" }
    });
    assert.deepEqual(await preferences.readAccountLanguagePreferences(user.id), {
      globalMode: "zh-terms-en",
      overrides: { matches: "en", practice: "zh-CN" }
    });
  });

  it("rejects invalid values before writing", async () => {
    const user = await db.user.create({ data: { email: "invalid-language@test.local", name: "Invalid" } });
    await assert.rejects(
      preferences.saveAccountLanguagePreferences(user.id, {
        globalMode: "en",
        overrides: { matches: "fr" }
      } as never),
      /Invalid language mode/
    );
    assert.equal((await preferences.readAccountLanguagePreferences(user.id))?.globalMode, null);
  });
});
