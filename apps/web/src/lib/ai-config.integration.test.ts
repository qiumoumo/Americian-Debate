import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { after, describe, it } from "node:test";

const databaseFileName = `ai-config-integration-${process.pid}.db`;
const databasePath = resolve(process.cwd(), "../../prisma", databaseFileName);
process.env.DATABASE_URL = `file:./${databaseFileName}`;
process.env.SESSION_SECRET = "ai-config-test-session-secret";
process.env.AI_ALLOW_PRIVATE_ENDPOINTS = "true";
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
const aiConfig = await import("./ai-config.ts");

const baseInput = {
  providerId: "mock",
  model: "",
  baseUrl: "",
  apiKey: "",
  enabled: true,
  clearKey: false
};

async function createUser(label: string) {
  return db.user.create({ data: { email: `${label}@ai.test`, name: label } });
}

after(async () => {
  await db.$disconnect();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-journal`, { force: true });
});

describe("AI configuration service", () => {
  it("stores multiple global configs and keeps exactly one enabled default", async () => {
    const admin = await createUser("global-admin");
    const first = await aiConfig.saveGlobalAIConfig({ ...baseInput, name: "Primary", updatedByUserId: admin.id });
    const second = await aiConfig.saveGlobalAIConfig({ ...baseInput, name: "Backup", updatedByUserId: admin.id });

    assert.equal(first.isDefault, true);
    assert.equal(second.isDefault, false);
    await aiConfig.setDefaultGlobalAIConfig(second.id);

    const configs = await aiConfig.getGlobalAIConfigs({ includeDisabled: true });
    assert.deepEqual(configs.map((config) => [config.name, config.isDefault]), [
      ["Backup", true],
      ["Primary", false]
    ]);
  });

  it("isolates personal configs and falls back to the global default when a selection is disabled", async () => {
    const admin = await createUser("selection-admin");
    const owner = await createUser("personal-owner");
    const outsider = await createUser("personal-outsider");
    const global = await aiConfig.saveGlobalAIConfig({ ...baseInput, name: "Global default", updatedByUserId: admin.id });
    await aiConfig.setDefaultGlobalAIConfig(global.id);
    const personal = await aiConfig.savePersonalAIConfig({ ...baseInput, name: "My AI", userId: owner.id });

    assert.equal((await aiConfig.getUserAIConfigs(outsider.id)).length, 0);
    await assert.rejects(
      aiConfig.savePersonalAIConfig({ ...baseInput, id: personal.id, name: "Stolen", userId: outsider.id }),
      /not found/i
    );

    await aiConfig.saveUserAISelection(owner.id, { mode: "CONFIG", configId: personal.id });
    assert.equal((await aiConfig.resolveAIProvider({ userId: owner.id, workspaceId: "unused" })).source, "personal");

    await aiConfig.savePersonalAIConfig({ ...baseInput, id: personal.id, name: "My AI", userId: owner.id, enabled: false });
    const resolved = await aiConfig.resolveAIProvider({ userId: owner.id, workspaceId: "unused" });
    assert.equal(resolved.source, "global");
    assert.equal(resolved.configId, global.id);
  });

  it("resets selections when a global config is disabled", async () => {
    const admin = await createUser("disable-admin");
    const user = await createUser("disable-user");
    const selected = await aiConfig.saveGlobalAIConfig({ ...baseInput, name: "Selected global", updatedByUserId: admin.id });
    await aiConfig.saveUserAISelection(user.id, { mode: "CONFIG", configId: selected.id });

    await aiConfig.saveGlobalAIConfig({
      ...baseInput,
      id: selected.id,
      name: selected.name,
      enabled: false,
      updatedByUserId: admin.id
    });

    assert.deepEqual(await aiConfig.getUserAISelection(user.id), { mode: "AUTO", configId: null });
  });

  it("handles deletion, key lifecycle, and environment fallback", async () => {
    await db.userAISelection.deleteMany();
    await db.aIConfig.deleteMany();
    const admin = await createUser("lifecycle-admin");
    const user = await createUser("lifecycle-user");
    const first = await aiConfig.saveGlobalAIConfig({ ...baseInput, name: "First global", updatedByUserId: admin.id });
    const second = await aiConfig.saveGlobalAIConfig({ ...baseInput, name: "Second global", updatedByUserId: admin.id });
    await aiConfig.saveUserAISelection(user.id, { mode: "CONFIG", configId: first.id });

    await aiConfig.deleteGlobalAIConfig(first.id);
    assert.deepEqual(await aiConfig.getUserAISelection(user.id), { mode: "AUTO", configId: null });
    assert.equal((await aiConfig.getGlobalAIConfigs()).find((config) => config.id === second.id)?.isDefault, true);

    await aiConfig.saveUserAISelection(user.id, { mode: "ENV" });
    assert.equal((await aiConfig.resolveAIProvider({ userId: user.id, workspaceId: "unused" })).source, "env");

    const personal = await aiConfig.savePersonalAIConfig({
      ...baseInput,
      name: "Key lifecycle",
      providerId: "deepseek",
      apiKey: "first-secret",
      userId: user.id
    });
    const retained = await aiConfig.savePersonalAIConfig({
      ...baseInput,
      id: personal.id,
      name: personal.name,
      providerId: "deepseek",
      userId: user.id
    });
    assert.equal(retained.hasKey, true);
    const cleared = await aiConfig.savePersonalAIConfig({
      ...baseInput,
      id: personal.id,
      name: personal.name,
      providerId: "deepseek",
      userId: user.id,
      enabled: false,
      clearKey: true
    });
    assert.equal(cleared.hasKey, false);
    await aiConfig.deletePersonalAIConfig(personal.id, user.id);
    assert.equal((await aiConfig.getUserAIConfigs(user.id)).length, 0);

    await aiConfig.deleteGlobalAIConfig(second.id);
    await aiConfig.saveUserAISelection(user.id, { mode: "AUTO" });
    assert.equal((await aiConfig.resolveAIProvider({ userId: user.id, workspaceId: "unused" })).source, "env");
  });

  it("encrypts keys and rejects incomplete enabled configs without returning secrets", async () => {
    const admin = await createUser("secret-admin");
    await assert.rejects(
      aiConfig.saveGlobalAIConfig({ ...baseInput, name: "Broken", providerId: "deepseek", updatedByUserId: admin.id }),
      /API Key/
    );

    const saved = await aiConfig.saveGlobalAIConfig({
      ...baseInput,
      name: "DeepSeek",
      providerId: "deepseek",
      apiKey: "plain-secret",
      updatedByUserId: admin.id
    });
    assert.equal(saved.hasKey, true);
    assert.equal(JSON.stringify(saved).includes("plain-secret"), false);

    const stored = await db.aIConfig.findUniqueOrThrow({ where: { id: saved.id }, select: { apiKeyEnc: true } });
    assert.notEqual(stored.apiKeyEnc, "plain-secret");
    assert.ok(stored.apiKeyEnc);
  });

  it("uses a saved key for model discovery without exposing it to another user", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/v1/models" && request.headers.authorization === "Bearer stored-secret") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ id: "listed-model" }] }));
        return;
      }
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "unauthorized" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind.");
      const owner = await createUser("probe-owner");
      const outsider = await createUser("probe-outsider");
      const input = {
        ...baseInput,
        name: "Stored probe",
        providerId: "openai-compatible",
        model: "listed-model",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey: "stored-secret"
      };
      const saved = await aiConfig.savePersonalAIConfig({ ...input, userId: owner.id });
      const result = await aiConfig.discoverModelsForConfig(
        { ...input, id: saved.id, apiKey: "" },
        { scope: "PERSONAL", userId: owner.id }
      );
      assert.deepEqual(result.models, ["listed-model"]);
      await assert.rejects(
        aiConfig.discoverModelsForConfig(
          { ...input, id: saved.id, baseUrl: `http://127.0.0.1:${address.port}/changed/v1`, apiKey: "" },
          { scope: "PERSONAL", userId: owner.id }
        ),
        /API Key/
      );
      await assert.rejects(
        aiConfig.savePersonalAIConfig({
          ...input,
          id: saved.id,
          baseUrl: `http://127.0.0.1:${address.port}/changed/v1`,
          apiKey: "",
          enabled: false,
          userId: owner.id
        }),
        /重新输入 API Key/
      );
      await assert.rejects(
        aiConfig.discoverModelsForConfig(
          { ...input, id: saved.id, apiKey: "" },
          { scope: "PERSONAL", userId: outsider.id }
        ),
        /not found/i
      );
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("persists the discovered /v1 URL and uses it for the resolved AI provider", async () => {
    const requests: Array<{ method?: string; url?: string }> = [];
    const server = createServer((request, response) => {
      requests.push({ method: request.method, url: request.url });
      if (request.headers.authorization !== "Bearer runtime-secret") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "unauthorized" } }));
        return;
      }
      if (request.method === "GET" && request.url === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ id: "runtime-model" }] }));
        return;
      }
      if (request.method === "POST" && request.url === "/v1/chat/completions") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1,
          model: "runtime-model",
          choices: [{ index: 0, message: { role: "assistant", content: "runtime-ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "not found" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind.");
      const admin = await createUser("runtime-admin");
      const user = await createUser("runtime-user");
      const rootUrl = `http://127.0.0.1:${address.port}`;
      const draft = await aiConfig.saveGlobalAIConfig({
        ...baseInput,
        name: "Runtime compatible",
        providerId: "openai-compatible",
        model: "runtime-model",
        baseUrl: rootUrl,
        apiKey: "runtime-secret",
        updatedByUserId: admin.id
      });
      const discovered = await aiConfig.discoverModelsForConfig(
        { ...baseInput, id: draft.id, name: draft.name, providerId: draft.providerId, model: draft.model, baseUrl: rootUrl, apiKey: "" },
        { scope: "GLOBAL" }
      );
      assert.equal(discovered.baseUrl, `${rootUrl}/v1`);
      const saved = await aiConfig.saveGlobalAIConfig({
        ...baseInput,
        id: draft.id,
        name: draft.name,
        providerId: draft.providerId,
        model: discovered.models[0] ?? "",
        baseUrl: discovered.baseUrl,
        apiKey: "runtime-secret",
        updatedByUserId: admin.id
      });
      await aiConfig.setDefaultGlobalAIConfig(saved.id);

      const resolved = await aiConfig.resolveAIProvider({ userId: user.id, workspaceId: "unused" });
      const reply = await resolved.provider.chat({ messages: [{ role: "user", content: "local test" }] });
      assert.equal(reply.text, "runtime-ok");
      assert.ok(requests.some((request) => request.method === "GET" && request.url === "/v1/models"));
      assert.ok(requests.some((request) => request.method === "POST" && request.url === "/v1/chat/completions"));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("backfills legacy workspace and user configs idempotently", async () => {
    await db.userAISelection.deleteMany();
    await db.aIConfig.deleteMany();
    const owner = await createUser("legacy-owner");
    const workspace = await db.workspace.create({ data: { name: "Legacy workspace" } });
    await db.membership.create({ data: { userId: owner.id, workspaceId: workspace.id, role: "OWNER" } });
    const workspaceConfig = await db.workspaceAIConfig.create({
      data: { workspaceId: workspace.id, providerId: "mock", enabled: true, updatedByUserId: owner.id }
    });
    const userConfig = await db.userAIConfig.create({
      data: { userId: owner.id, providerId: "mock", enabled: true, preferredSource: "personal" }
    });

    const { backfillLegacyAIConfigs } = await import("../../../../packages/db/src/ai-config-backfill.ts");
    await backfillLegacyAIConfigs();
    await backfillLegacyAIConfigs();

    const migrated = await db.aIConfig.findMany({ orderBy: { scope: "asc" } });
    assert.equal(migrated.length, 2);
    assert.equal(migrated.find((config) => config.legacyRef === `workspace:${workspaceConfig.id}`)?.isDefault, true);
    const personal = migrated.find((config) => config.legacyRef === `user:${userConfig.id}`);
    assert.equal(personal?.ownerUserId, owner.id);
    assert.deepEqual(await aiConfig.getUserAISelection(owner.id), { mode: "CONFIG", configId: personal?.id });
  });
});
