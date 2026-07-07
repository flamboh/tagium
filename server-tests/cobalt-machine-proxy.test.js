import http from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createCobaltProxyServer } from "../cobalt-machine-proxy.mjs";

const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
};

const closeServer = async (server) => {
  if (!server.listening) {
    return;
  }
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
};

const createControlledUpstream = () => {
  const requests = [];
  const waiters = [];
  let requestCount = 0;

  const server = http.createServer((request, response) => {
    request.resume();
    requestCount += 1;
    const entry = { request, response, path: request.url };
    const waiter = waiters.shift();
    if (waiter) {
      waiter(entry);
      return;
    }
    requests.push(entry);
  });

  return {
    server,
    waitForRequest: () => {
      const request = requests.shift();
      if (request) {
        return Promise.resolve(request);
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
    get requestCount() {
      return requestCount;
    },
  };
};

const createProxy = async (upstreamPort, proxyConfig) => {
  const server = createCobaltProxyServer({
    cobaltHost: "127.0.0.1",
    cobaltPort: upstreamPort,
    runtimeEnv: { FLY_MACHINE_ID: "test-machine" },
    proxyConfig,
  });
  const port = await listen(server);
  return { server, origin: `http://127.0.0.1:${port}` };
};

const complete = (entry, body = "ok") => {
  entry.response.writeHead(200, { "content-type": "text/plain" });
  entry.response.end(body);
};

describe("cobalt machine proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 503 when the resolve queue is full", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const upstream = createControlledUpstream();
    const upstreamPort = await listen(upstream.server);
    const proxy = await createProxy(upstreamPort, {
      maxConcurrentResolve: 1,
      maxConcurrentTunnel: 1,
      maxQueuedResolve: 0,
      maxQueuedTunnel: 0,
      maxQueueWaitMs: 1_000,
    });
    const firstAbort = new AbortController();
    const firstFetch = fetch(`${proxy.origin}/`, {
      method: "POST",
      body: "first",
      signal: firstAbort.signal,
    }).catch(() => undefined);

    try {
      await upstream.waitForRequest();
      const response = await fetch(`${proxy.origin}/`, {
        method: "POST",
        body: "second",
      });

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("2");
      await expect(response.json()).resolves.toMatchObject({
        status: "error",
        error: { code: "error.api.capacity_exceeded" },
      });
    } finally {
      firstAbort.abort();
      await firstFetch;
      await closeServer(proxy.server);
      await closeServer(upstream.server);
    }
  });

  it("returns 503 when a queued resolve request waits too long", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const upstream = createControlledUpstream();
    const upstreamPort = await listen(upstream.server);
    const proxy = await createProxy(upstreamPort, {
      maxConcurrentResolve: 1,
      maxConcurrentTunnel: 1,
      maxQueuedResolve: 1,
      maxQueuedTunnel: 1,
      maxQueueWaitMs: 20,
    });
    const firstAbort = new AbortController();
    const firstFetch = fetch(`${proxy.origin}/`, {
      method: "POST",
      body: "first",
      signal: firstAbort.signal,
    }).catch(() => undefined);

    try {
      await upstream.waitForRequest();
      const response = await fetch(`${proxy.origin}/`, {
        method: "POST",
        body: "queued",
      });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "error.api.capacity_exceeded" },
      });
      expect(upstream.requestCount).toBe(1);
    } finally {
      firstAbort.abort();
      await firstFetch;
      await closeServer(proxy.server);
      await closeServer(upstream.server);
    }
  });

  it("removes a request from the queue when the client disconnects while queued", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const upstream = createControlledUpstream();
    const upstreamPort = await listen(upstream.server);
    const proxy = await createProxy(upstreamPort, {
      maxConcurrentResolve: 1,
      maxConcurrentTunnel: 1,
      maxQueuedResolve: 1,
      maxQueuedTunnel: 1,
      maxQueueWaitMs: 1_000,
    });
    const firstFetch = fetch(`${proxy.origin}/`, {
      method: "POST",
      body: "first",
    });

    try {
      const firstUpstream = await upstream.waitForRequest();
      const queuedRequest = http.request(`${proxy.origin}/`, {
        method: "POST",
      });
      queuedRequest.on("error", () => undefined);
      queuedRequest.end("queued");
      await new Promise((resolve) => setTimeout(resolve, 20));
      queuedRequest.destroy();
      await new Promise((resolve) => setTimeout(resolve, 20));

      complete(firstUpstream);
      await expect(firstFetch.then((response) => response.text())).resolves.toBe("ok");
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(upstream.requestCount).toBe(1);

      const thirdFetch = fetch(`${proxy.origin}/`, {
        method: "POST",
        body: "third",
        signal: AbortSignal.timeout(500),
      });
      complete(await upstream.waitForRequest(), "third-ok");
      await expect(thirdFetch.then((response) => response.text())).resolves.toBe("third-ok");
    } finally {
      await closeServer(proxy.server);
      await closeServer(upstream.server);
    }
  });

  it("destroys the upstream tunnel and releases capacity when the downstream closes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const upstream = createControlledUpstream();
    const upstreamPort = await listen(upstream.server);
    const proxy = await createProxy(upstreamPort, {
      maxConcurrentResolve: 1,
      maxConcurrentTunnel: 1,
      maxQueuedResolve: 0,
      maxQueuedTunnel: 0,
      maxQueueWaitMs: 1_000,
    });

    try {
      const clientClosedAfterChunk = new Promise((resolve, reject) => {
        const request = http.get(`${proxy.origin}/tunnel?id=stream`, (response) => {
          response.once("data", () => {
            request.destroy();
            resolve();
          });
        });
        request.once("error", reject);
      });
      const upstreamTunnel = await upstream.waitForRequest();
      const upstreamClosed = once(upstreamTunnel.response, "close");
      upstreamTunnel.response.writeHead(200, { "content-type": "audio/mpeg" });
      upstreamTunnel.response.write("audio");

      await clientClosedAfterChunk;
      await upstreamClosed;

      const nextFetch = fetch(`${proxy.origin}/tunnel?id=next`, {
        signal: AbortSignal.timeout(500),
      });
      complete(await upstream.waitForRequest(), "next-ok");
      await expect(nextFetch.then((response) => response.text())).resolves.toBe("next-ok");
    } finally {
      await closeServer(proxy.server);
      await closeServer(upstream.server);
    }
  });
});
