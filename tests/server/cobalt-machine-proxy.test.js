import http from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createCobaltProxyServer,
  createGate,
  drainCobaltProxyServer,
  getDrainTimeoutMs,
} from "../../cobalt-machine-proxy.mjs";

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

const createProxy = async (upstreamPort, proxyConfig, lifecycle) => {
  const server = createCobaltProxyServer({
    cobaltHost: "127.0.0.1",
    cobaltPort: upstreamPort,
    runtimeEnv: { FLY_MACHINE_ID: "test-machine" },
    proxyConfig,
    lifecycle,
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

  it("validates the graceful drain deadline", () => {
    expect(getDrainTimeoutMs({})).toBe(270_000);
    expect(getDrainTimeoutMs({ PROXY_DRAIN_TIMEOUT_MS: "120000" })).toBe(120_000);
    expect(() => getDrainTimeoutMs({ PROXY_DRAIN_TIMEOUT_MS: "nope" })).toThrow(
      "PROXY_DRAIN_TIMEOUT_MS",
    );
    expect(() => getDrainTimeoutMs({ PROXY_DRAIN_TIMEOUT_MS: "280000" })).toThrow(
      "PROXY_DRAIN_TIMEOUT_MS",
    );
  });

  it("rejects queued work when draining without granting it later", () => {
    const gate = createGate("resolve", 1, 1, 1_000);
    const queuedGrant = vi.fn();
    const queuedReject = vi.fn();

    gate.acquire({ onGranted: vi.fn(), onRejected: vi.fn() });
    gate.acquire({ onGranted: queuedGrant, onRejected: queuedReject });
    gate.drain();
    gate.release();

    expect(queuedReject).toHaveBeenCalledWith("draining");
    expect(queuedGrant).not.toHaveBeenCalled();
    expect(gate.active).toBe(0);
    expect(gate.queued).toBe(0);
  });

  it("forces connections closed when graceful draining reaches its deadline", async () => {
    vi.useFakeTimers();
    const lifecycle = { draining: false };
    const cobalt = { kill: vi.fn() };
    const server = {
      listening: true,
      beginDraining: vi.fn(),
      close: vi.fn(),
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
    };

    try {
      const shutdown = drainCobaltProxyServer({
        server,
        cobalt,
        lifecycle,
        drainTimeoutMs: 50,
      });
      await vi.advanceTimersByTimeAsync(50);
      await shutdown;

      expect(server.closeAllConnections).toHaveBeenCalledOnce();
      expect(cobalt.kill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves health and readiness without forwarding to Cobalt", async () => {
    const upstream = createControlledUpstream();
    const upstreamPort = await listen(upstream.server);
    const lifecycle = { draining: false };
    const proxy = await createProxy(
      upstreamPort,
      {
        maxConcurrentResolve: 1,
        maxConcurrentTunnel: 1,
        maxQueuedResolve: 0,
        maxQueuedTunnel: 0,
        maxQueueWaitMs: 1_000,
      },
      lifecycle,
    );

    try {
      const health = await fetch(`${proxy.origin}/healthz`);
      const ready = await fetch(`${proxy.origin}/readyz`);

      expect(health.status).toBe(200);
      expect(ready.status).toBe(200);
      expect(upstream.requestCount).toBe(0);

      lifecycle.draining = true;
      const drainingReady = await fetch(`${proxy.origin}/readyz`);
      const rejectedWork = await fetch(`${proxy.origin}/`, { method: "POST" });
      expect(drainingReady.status).toBe(503);
      expect(rejectedWork.status).toBe(503);
      expect(rejectedWork.headers.get("connection")).toBe("close");
      expect(upstream.requestCount).toBe(0);
    } finally {
      await closeServer(proxy.server);
      await closeServer(upstream.server);
    }
  });

  it("waits for active responses before stopping Cobalt", async () => {
    const upstream = createControlledUpstream();
    const upstreamPort = await listen(upstream.server);
    const lifecycle = { draining: false };
    const proxy = await createProxy(
      upstreamPort,
      {
        maxConcurrentResolve: 1,
        maxConcurrentTunnel: 1,
        maxQueuedResolve: 0,
        maxQueuedTunnel: 0,
        maxQueueWaitMs: 1_000,
      },
      lifecycle,
    );
    const cobalt = { kill: vi.fn() };
    const activeFetch = fetch(`${proxy.origin}/`, { method: "POST", body: "active" });

    try {
      const activeUpstream = await upstream.waitForRequest();
      const shutdown = drainCobaltProxyServer({
        server: proxy.server,
        cobalt,
        lifecycle,
        signal: "SIGTERM",
        drainTimeoutMs: 1_000,
      });

      expect(lifecycle.draining).toBe(true);
      expect(cobalt.kill).not.toHaveBeenCalled();

      complete(activeUpstream, "finished");
      await expect(activeFetch.then((response) => response.text())).resolves.toBe("finished");
      await shutdown;
      expect(cobalt.kill).toHaveBeenCalledOnce();
      expect(cobalt.kill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      await closeServer(proxy.server);
      await closeServer(upstream.server);
    }
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

  it("correlates structured Cobalt errors without logging the source URL", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const upstream = createControlledUpstream();
    const upstreamPort = await listen(upstream.server);
    const proxy = await createProxy(upstreamPort, {
      maxConcurrentResolve: 1,
      maxConcurrentTunnel: 1,
      maxQueuedResolve: 0,
      maxQueuedTunnel: 0,
      maxQueueWaitMs: 1_000,
    });
    const sourceUrl = "https://soundcloud.com/artist/private-track";
    const responsePromise = fetch(`${proxy.origin}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tagium-Request-Id": "request-1",
        "X-Tagium-Parent-Request-Id": "plan-request-1",
        "X-Tagium-Import-Id": "import-1",
        "X-Tagium-Source-Fingerprint": `sha256:${"a".repeat(32)}`,
        "X-Tagium-Track-Index": "7",
      },
      body: JSON.stringify({ url: sourceUrl }),
    });

    try {
      const request = await upstream.waitForRequest();
      request.response.writeHead(400, { "content-type": "application/json" });
      request.response.end(
        JSON.stringify({
          status: "error",
          error: { code: "error.api.fetch.fail", context: { service: "soundcloud" } },
        }),
      );
      await expect(responsePromise.then((response) => response.json())).resolves.toMatchObject({
        error: { code: "error.api.fetch.fail" },
      });

      const event = log.mock.calls
        .map(([entry]) => JSON.parse(entry))
        .find((entry) => entry.requestId === "request-1");
      expect(event).toMatchObject({
        event: "cobalt_proxy_request",
        requestId: "request-1",
        parentRequestId: "plan-request-1",
        importId: "import-1",
        sourceFingerprint: `sha256:${"a".repeat(32)}`,
        trackIndex: 7,
        machineId: "test-machine",
        status: 400,
        errorCode: "error.api.fetch.fail",
        service: "soundcloud",
      });
      expect(JSON.stringify(event)).not.toContain(sourceUrl);
    } finally {
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
