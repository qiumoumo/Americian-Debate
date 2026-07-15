import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";

const requests: Array<{ method?: string; url?: string; authorization?: string; apiKey?: string; body?: string }> = [];
let server: ReturnType<typeof createServer>;
let baseUrl = "";

before(async () => {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      apiKey: typeof request.headers["x-api-key"] === "string" ? request.headers["x-api-key"] : undefined,
      body
    });
    if (request.url === "/models") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "authentication required" } }));
      return;
    }
    if (request.url?.startsWith("/anthropic/v1/messages")) {
      if (request.headers["x-api-key"] !== "test-key") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "invalid key" } }));
        return;
      }
      const payload = JSON.parse(body) as { model?: string };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "msg-test",
        type: "message",
        role: "assistant",
        model: payload.model,
        content: [{ type: "text", text: "OK" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 3, output_tokens: 1 }
      }));
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
    if (request.url === "/v1/chat/completions" || request.url === "/chat-only/v1/chat/completions") {
      const payload = JSON.parse(body) as { model?: string };
      if (payload.model !== "model-alpha") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "model not found" } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "test-completion",
        model: payload.model,
        choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }]
      }));
      return;
    }
    if (request.url === "/invalid/v1/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "model invalid-model was not found" } }));
      return;
    }
    if (request.url === "/incompatible/v1/chat/completions") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === "/large-chat/v1/chat/completions") {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"choices":[{"message":{"content":"OK"},"finish_reason":"stop"}],"padding":"');
      response.write(Buffer.alloc(1024 * 1024 + 1, 97));
      response.end('"}');
      return;
    }
    if (request.url === "/slow/v1/chat/completions") {
      setTimeout(() => {
        if (response.destroyed) return;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] }));
      }, 100);
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
      model: "model-alpha",
      allowPrivateNetwork: true
    });

    assert.deepEqual(result.models, ["model-alpha", "model-beta"]);
    assert.equal(result.baseUrl, `${baseUrl}/v1`);
    assert.deepEqual(requests.slice(0, 2).map((request) => request.url), ["/models", "/v1/models"]);
  });

  it("tests connectivity through the configured model's chat endpoint", async () => {
    requests.length = 0;
    const { testAIEndpointConnection } = await import("./ai-endpoint.ts");
    const result = await testAIEndpointConnection({
      providerId: "openai-compatible",
      baseUrl,
      apiKey: "test-key",
      model: "model-alpha",
      allowPrivateNetwork: true
    });

    assert.equal(result.ok, true);
    assert.equal(result.baseUrl, `${baseUrl}/v1`);
    assert.ok(result.latencyMs >= 0);
    assert.equal(requests.at(-1)?.method, "POST");
    assert.equal(requests.at(-1)?.url, "/v1/chat/completions");
    assert.equal(JSON.parse(requests.at(-1)?.body ?? "{}").model, "model-alpha");
    assert.equal(JSON.parse(requests.at(-1)?.body ?? "{}").max_tokens, 8);
  });

  it("connects when chat works even if the provider has no model-list endpoint", async () => {
    const { discoverAIModels, testAIEndpointConnection } = await import("./ai-endpoint.ts");
    const input = {
      providerId: "openai-compatible",
      baseUrl: `${baseUrl}/chat-only/v1`,
      apiKey: "test-key",
      model: "model-alpha",
      allowPrivateNetwork: true
    };
    const connected = await testAIEndpointConnection(input);
    assert.equal(connected.ok, true);
    assert.deepEqual(connected.models, []);
    await assert.rejects(discoverAIModels(input), /模型端点/);
  });

  it("tests Anthropic through the messages endpoint and x-api-key header", async () => {
    requests.length = 0;
    const { testAIEndpointConnection } = await import("./ai-endpoint.ts");
    const result = await testAIEndpointConnection({
      providerId: "anthropic",
      baseUrl: `${baseUrl}/anthropic/v1`,
      apiKey: "test-key",
      model: "claude-test",
      allowPrivateNetwork: true
    });
    assert.equal(result.ok, true);
    assert.equal(requests.at(-1)?.url, "/anthropic/v1/messages");
    assert.equal(requests.at(-1)?.apiKey, "test-key");
  });

  it("returns a clear authentication error without exposing the key", async () => {
    const { discoverAIModels } = await import("./ai-endpoint.ts");
    await assert.rejects(
      discoverAIModels({ providerId: "openai-compatible", baseUrl, apiKey: "wrong-key", model: "model-alpha", allowPrivateNetwork: true }),
      (error: unknown) => error instanceof Error && /API Key/.test(error.message) && !error.message.includes("wrong-key")
    );
  });

  it("classifies chat authentication, model, and incompatible-response failures", async () => {
    const { testAIEndpointConnection } = await import("./ai-endpoint.ts");
    await assert.rejects(
      testAIEndpointConnection({
        providerId: "openai-compatible",
        baseUrl: `${baseUrl}/v1`,
        apiKey: "wrong-chat-key",
        model: "model-alpha",
        allowPrivateNetwork: true
      }),
      (error: unknown) => error instanceof Error && /API Key/.test(error.message) && !error.message.includes("wrong-chat-key")
    );
    await assert.rejects(
      testAIEndpointConnection({
        providerId: "openai-compatible",
        baseUrl: `${baseUrl}/invalid/v1`,
        apiKey: "test-key",
        model: "invalid-model",
        allowPrivateNetwork: true
      }),
      (error: unknown) => error instanceof Error
        && /模型不可用/.test(error.message)
        && (error as { fieldErrors?: Record<string, string> }).fieldErrors?.model !== undefined
    );
    await assert.rejects(
      testAIEndpointConnection({
        providerId: "openai-compatible",
        baseUrl: `${baseUrl}/incompatible/v1`,
        apiKey: "test-key",
        model: "model-alpha",
        allowPrivateNetwork: true
      }),
      /不是兼容的聊天结果/
    );
  });

  it("reports an unresolvable public hostname as a Base URL error", async () => {
    const { testAIEndpointConnection } = await import("./ai-endpoint.ts");
    await assert.rejects(
      testAIEndpointConnection({
        providerId: "openai-compatible",
        baseUrl: "https://ai-endpoint-does-not-exist.invalid/v1",
        apiKey: "test-key",
        model: "model-alpha"
      }),
      /无法解析 Base URL/
    );
  });

  it("times out a slow chat endpoint with a structured Base URL error", async () => {
    const { testAIEndpointConnection } = await import("./ai-endpoint.ts");
    await assert.rejects(
      testAIEndpointConnection({
        providerId: "openai-compatible",
        baseUrl: `${baseUrl}/slow/v1`,
        apiKey: "test-key",
        model: "model-alpha",
        allowPrivateNetwork: true
      }, { timeoutMs: 30 }),
      (error: unknown) => error instanceof Error
        && /连接超时/.test(error.message)
        && (error as { fieldErrors?: Record<string, string> }).fieldErrors?.baseUrl !== undefined
    );
  });

  it("stops reading a chunked chat response after the size limit", async () => {
    const { testAIEndpointConnection } = await import("./ai-endpoint.ts");
    await assert.rejects(
      testAIEndpointConnection({
        providerId: "openai-compatible",
        baseUrl: `${baseUrl}/large-chat/v1`,
        apiKey: "test-key",
        model: "model-alpha",
        allowPrivateNetwork: true
      }),
      /响应过大/
    );
  });

  it("blocks private endpoints by default and caps remote response sizes", async () => {
    const { discoverAIModels } = await import("./ai-endpoint.ts");
    await assert.rejects(
      discoverAIModels({ providerId: "openai-compatible", baseUrl: `${baseUrl}/v1`, apiKey: "test-key", model: "model-alpha" }),
      /内网地址/
    );
    await assert.rejects(
      discoverAIModels({ providerId: "openai-compatible", baseUrl: `${baseUrl}/large/v1`, apiKey: "test-key", model: "model-alpha", allowPrivateNetwork: true }),
      /响应过大/
    );
  });
});
