import assert from "node:assert/strict";
import { Agent, createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { after, before, describe, it } from "node:test";
import { configureAIOutboundProxy } from "./ai-outbound-proxy.ts";

let targetServer: ReturnType<typeof createServer>;
let proxyServer: ReturnType<typeof createServer>;
let targetUrl = "";
let proxyUrl = "";
let proxyRequests = 0;
const previousProxy = {
  HTTP_PROXY: process.env.HTTP_PROXY,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  NO_PROXY: process.env.NO_PROXY
};

before(async () => {
  targetServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("proxy-ok");
  });
  await new Promise<void>((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
  const targetAddress = targetServer.address();
  if (!targetAddress || typeof targetAddress === "string") throw new Error("Target server did not bind.");
  targetUrl = `http://127.0.0.1:${targetAddress.port}/health`;

  proxyServer = createServer((request, response) => {
    proxyRequests += 1;
    const target = new URL(request.url ?? "");
    const forwarded = httpRequest(target, { method: request.method, headers: request.headers, agent: new Agent() }, (upstream) => {
      response.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(response);
    });
    forwarded.on("error", (error) => response.destroy(error));
    request.pipe(forwarded);
  });
  proxyServer.on("connect", (request, clientSocket, head) => {
    proxyRequests += 1;
    const [host, rawPort] = (request.url ?? "").split(":");
    const serverSocket = connect(Number(rawPort), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });
    serverSocket.on("error", (error) => clientSocket.destroy(error));
  });
  await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
  const proxyAddress = proxyServer.address();
  if (!proxyAddress || typeof proxyAddress === "string") throw new Error("Proxy server did not bind.");
  proxyUrl = `http://127.0.0.1:${proxyAddress.port}`;
});

after(async () => {
  for (const [name, value] of Object.entries(previousProxy)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  configureAIOutboundProxy();
  await Promise.all([
    new Promise<void>((resolve, reject) => targetServer.close((error) => error ? reject(error) : resolve())),
    new Promise<void>((resolve, reject) => proxyServer.close((error) => error ? reject(error) : resolve()))
  ]);
});

describe("AI outbound proxy", () => {
  it("routes fetch requests through the proxy configured after process startup", async () => {
    process.env.HTTP_PROXY = proxyUrl;
    delete process.env.HTTPS_PROXY;
    process.env.NO_PROXY = "";
    assert.equal(configureAIOutboundProxy(), true);

    const response = await fetch(targetUrl);
    assert.equal(await response.text(), "proxy-ok");
    assert.equal(proxyRequests, 1);
  });
});
