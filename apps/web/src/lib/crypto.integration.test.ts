import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

const cryptoModule = pathToFileURL(resolve(process.cwd(), "src/lib/crypto.ts")).href;

function runCryptoProbe(env: Record<string, string | undefined>) {
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `import { encryptSecret, decryptSecret } from ${JSON.stringify(cryptoModule)};
       const encrypted = encryptSecret("secret-value");
       console.log(decryptSecret(encrypted));`
    ],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ...env,
        NODE_ENV: "production"
      },
      encoding: "utf8"
    }
  );
}

describe("AI configuration encryption", () => {
  it("uses SESSION_SECRET when production has no dedicated encryption key", () => {
    const result = runCryptoProbe({ SESSION_SECRET: "session-secret-long-enough" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "secret-value");
  });

  it("rejects production encryption when neither secret is usable", () => {
    const result = runCryptoProbe({ SESSION_SECRET: "short" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /APP_ENCRYPTION_KEY|SESSION_SECRET/);
  });

  it("returns a structured save error without writing a config when encryption is unavailable", () => {
    const databaseFileName = `crypto-action-${process.pid}.db`;
    const databasePath = resolve(process.cwd(), "../../prisma", databaseFileName);
    writeFileSync(databasePath, "");
    const prismaCli = resolve(process.cwd(), "../../packages/db/node_modules/prisma/build/index.js");
    const pushed = spawnSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", "../../prisma/schema.prisma"], {
      cwd: resolve(process.cwd(), "../../packages/db"),
      env: { ...process.env, DATABASE_URL: `file:./${databaseFileName}` },
      encoding: "utf8"
    });
    assert.equal(pushed.status, 0, pushed.stderr || pushed.stdout);

    const probe = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        `import { db } from '@debate/db';
         import { saveGlobalAIConfig, toActionError } from ${JSON.stringify(cryptoModule.replace("crypto.ts", "ai-config.ts"))};
         const user = await db.user.create({ data: { email: 'crypto-action@test.local', name: 'Crypto action' } });
         let state;
         try {
           await saveGlobalAIConfig({ name: 'Should not save', providerId: 'deepseek', model: '', baseUrl: '', apiKey: 'plain-key', enabled: true, updatedByUserId: user.id });
         } catch (error) { state = toActionError(error); }
         const count = await db.aIConfig.count();
         console.log(JSON.stringify({ state, count }));
         await db.$disconnect();`
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "production",
          DATABASE_URL: `file:./${databaseFileName}`,
          SESSION_SECRET: "short",
          APP_ENCRYPTION_KEY: "short"
        },
        encoding: "utf8"
      }
    );

    try {
      assert.equal(probe.status, 0, probe.stderr);
      const result = JSON.parse(probe.stdout.trim());
      assert.equal(result.state.ok, false);
      assert.match(result.state.message, /加密密钥/);
      assert.equal(result.count, 0);
    } finally {
      rmSync(databasePath, { force: true });
      rmSync(`${databasePath}-journal`, { force: true });
    }
  });
});
