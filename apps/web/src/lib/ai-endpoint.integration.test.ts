import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";

const requests: Array<{ method?: string; url?: string; authorization?: string }> = [];
let server: ReturnType<typeof createServer>;
let baseUrl = "";

before(async () => {
  server = createServer((request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization
    });
    if (request.url === "/models") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "authentication required" } }));
      return;
    }
    if (request.headers.authorization !== "Bearer test-key") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "invalid key" } }));
      return;
    }
    if (request.url === "/empty/v1/models") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.url === "/large/v1/models") {
      response.writeHead(200, { "content-type": "application/json", "content-length": String(1024 * 1024 + 1) });
      response.end();
      return;
    }
    if (request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "model-beta" }, { id: "model-alpha" }] }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("AI endpoint inspection", () => {
  it("discovers models and returns the working /v1 base URL", async () => {
    const { discoverAIModels } = await import("./ai-endpoint.ts");
    const result = await discoverAIModels({
      providerId: "openai-compatible",
      baseUrl,
      apiKey: "test-key",
      allowPrivateNetwork: true
    });

    assert.deepEqual(result.models, ["model-alpha", "model-beta"]);
    assert.equal(result.baseUrl, `${baseUrl}/v1`);
    assert.deepEqual(requests.slice(0, 2).map((request) => request.url), ["/models", "/v1/models"]);
  });

  it("tests connectivity with model-list GET requests and never sends a prompt", async () => {
    requests.length = 0;
    const { testAIEndpointConnection } = await import("./ai-endpoint.ts");
    const result = await testAIEndpointConnection({
      providerId: "openai-compatible",
      baseUrl,
      apiKey: "test-key",
      allowPrivateNetwork: true
    });

    assert.equal(result.ok, true);
    assert.equal(result.baseUrl, `${baseUrl}/v1`);
    assert.ok(result.latencyMs >= 0);
    assert.ok(requests.length > 0);
    assert.ok(requests.every((request) => request.method === "GET" && request.url?.endsWith("/models")));
  });

  it("treats an authenticated empty response as connected but not as a model list", async () => {
    const { discoverAIModels, testAIEndpointConnection } = await import("./ai-endpoint.ts");
    const input = {
      providerId: "openai-compatible",
      baseUrl: `${baseUrl}/empty/v1`,
      apiKey: "test-key",
      allowPrivateNetwork: true
    };
    const connected = await testAIEndpointConnection(input);
    assert.equal(connected.ok, true);
    assert.deepEqual(connected.models, []);
    await assert.rejects(discoverAIModels(input), /没有可识别的模型列表/);
  });

  it("returns a clear authentication error without exposing the key", async () => {
    const { discoverAIModels } = await import("./ai-endpoint.ts");
    await assert.rejects(
      discoverAIModels({ providerId: "openai-compatible", baseUrl, apiKey: "wrong-key", allowPrivateNetwork: true }),
      (error: unknown) => error instanceof Error && /API Key/.test(error.message) && !error.message.includes("wrong-key")
    );
  });

  it("blocks private endpoints by default and caps remote response sizes", async () => {
    const { discoverAIModels } = await import("./ai-endpoint.ts");
    await assert.rejects(
      discoverAIModels({ providerId: "openai-compatible", baseUrl: `${baseUrl}/v1`, apiKey: "test-key" }),
      /内网地址/
    );
    await assert.rejects(
      discoverAIModels({ providerId: "openai-compatible", baseUrl: `${baseUrl}/large/v1`, apiKey: "test-key", allowPrivateNetwork: true }),
      /响应过大/
    );
  });
});
