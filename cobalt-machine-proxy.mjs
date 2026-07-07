import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { env, exit, argv } from "node:process";
import { fileURLToPath } from "node:url";

const proxyPort = 9000;
const cobaltHost = "127.0.0.1";
const cobaltPort = 9001;
let nextRequestId = 0;

const getProxyRequestId = (clientRequest) => {
  const header = clientRequest.headers["x-tagium-tunnel-request-id"];
  if (Array.isArray(header)) {
    const [firstHeader] = header;
    if (firstHeader) return firstHeader;
  }
  if (header) return header;

  nextRequestId += 1;
  return `cobalt-proxy-${nextRequestId}`;
};

const getRequestContext = (clientRequest, requestId, runtimeEnv) => {
  const requestUrl = new URL(clientRequest.url ?? "/", "http://tagium-cobalt.local");
  const context = {
    event: "cobalt_proxy_request",
    requestId,
    machineId: runtimeEnv.FLY_MACHINE_ID,
    method: clientRequest.method,
    path: requestUrl.pathname,
  };
  const tunnelId = requestUrl.searchParams.get("id");
  if (tunnelId) {
    context.tunnelId = tunnelId;
  }

  return context;
};

const logProxy = (message, context) => {
  console.log(JSON.stringify({ message, ...context }));
};

const logProxyError = (message, context) => {
  console.error(JSON.stringify({ message, ...context }));
};

export const getProxyConfig = (runtimeEnv = env) => ({
  maxConcurrentResolve: Number(runtimeEnv.PROXY_MAX_CONCURRENT_RESOLVE ?? 24),
  maxConcurrentTunnel: Number(runtimeEnv.PROXY_MAX_CONCURRENT_TUNNEL ?? 48),
  maxQueuedResolve: Number(runtimeEnv.PROXY_MAX_QUEUED_RESOLVE ?? 48),
  maxQueuedTunnel: Number(runtimeEnv.PROXY_MAX_QUEUED_TUNNEL ?? 96),
  maxQueueWaitMs: Number(runtimeEnv.PROXY_MAX_QUEUE_WAIT_MS ?? 15_000),
});

/*
 * Concurrency gates protect the single shared vCPU behind this proxy. Load testing found this
 * Machine handles roughly 20-45 concurrent real downloads (resolve + audio/cover tunnel fetches)
 * comfortably, degrades noticeably by ~100, and falls into multi-minute backlog beyond ~150-200 -
 * see docs/cobalt-load-test-2026-07-07.html. Requests over the concurrent cap are queued briefly;
 * requests that can't be queued (or wait too long) get a fast, explicit rejection instead of
 * silently piling up on Cobalt until everything times out.
 *
 * Resolve (POST /) and tunnel (GET /tunnel) are gated separately, at roughly Cobalt's own
 * built-in rate limit ratio (20 resolve : 40 tunnel), since a real download fetches one resolve
 * plan plus its audio tunnel and (usually) a cover art tunnel - about 2 tunnel fetches per
 * resolve call.
 */
export const createGate = (name, maxConcurrent, maxQueued, maxQueueWaitMs) => {
  let active = 0;
  const queue = [];

  const grantNext = () => {
    if (active >= maxConcurrent) {
      return;
    }
    const next = queue.shift();
    if (!next) {
      return;
    }
    active += 1;
    clearTimeout(next.timeoutHandle);
    next.grant();
  };

  const release = () => {
    active = Math.max(0, active - 1);
    grantNext();
  };

  const acquire = ({ onGranted, onRejected }) => {
    if (active < maxConcurrent) {
      active += 1;
      onGranted();
      return { cancel: () => {} };
    }

    if (queue.length >= maxQueued) {
      onRejected("queue_full");
      return { cancel: () => {} };
    }

    const entry = { grant: onGranted };
    entry.timeoutHandle = setTimeout(() => {
      const index = queue.indexOf(entry);
      if (index >= 0) {
        queue.splice(index, 1);
        onRejected("queue_timeout");
      }
    }, maxQueueWaitMs);
    queue.push(entry);

    return {
      cancel: () => {
        const index = queue.indexOf(entry);
        if (index >= 0) {
          queue.splice(index, 1);
          clearTimeout(entry.timeoutHandle);
        }
      },
    };
  };

  return {
    name,
    acquire,
    release,
    get active() {
      return active;
    },
    get queued() {
      return queue.length;
    },
  };
};

const capacityErrorBody = JSON.stringify({
  status: "error",
  error: { code: "error.api.capacity_exceeded" },
});

export const createCobaltProxyServer = ({
  cobaltHost: upstreamHost = cobaltHost,
  cobaltPort: upstreamPort = cobaltPort,
  runtimeEnv = env,
  proxyConfig = getProxyConfig(runtimeEnv),
} = {}) => {
  const resolveGate = createGate(
    "resolve",
    proxyConfig.maxConcurrentResolve,
    proxyConfig.maxQueuedResolve,
    proxyConfig.maxQueueWaitMs,
  );
  const tunnelGate = createGate(
    "tunnel",
    proxyConfig.maxConcurrentTunnel,
    proxyConfig.maxQueuedTunnel,
    proxyConfig.maxQueueWaitMs,
  );

  const getGateForPath = (pathname) => (pathname.startsWith("/tunnel") ? tunnelGate : resolveGate);

  return http.createServer((clientRequest, clientResponse) => {
    const requestId = getProxyRequestId(clientRequest);
    const startedAt = Date.now();
    const context = getRequestContext(clientRequest, requestId, runtimeEnv);
    const requestUrl = new URL(clientRequest.url ?? "/", "http://tagium-cobalt.local");
    const gate = getGateForPath(requestUrl.pathname);

    let released = false;
    let acquired = false;
    let queued = true;
    let clientLeftWhileQueued = false;

    const releaseGate = () => {
      if (released) {
        return;
      }
      released = true;
      gate.release();
    };

    const rejectWithCapacityExceeded = (reason) => {
      queued = false;
      logProxyError("gate rejected request", {
        ...context,
        gate: gate.name,
        reason,
        queued: gate.queued,
        active: gate.active,
        elapsedMs: Date.now() - startedAt,
      });

      if (clientResponse.headersSent || clientResponse.writableEnded) {
        return;
      }

      clientResponse.writeHead(503, {
        "content-type": "application/json;charset=UTF-8",
        "retry-after": "2",
      });
      clientResponse.end(capacityErrorBody);
    };

    const forwardToUpstream = () => {
      let upstreamResponseEnded = false;
      let destroyedBecauseClientLeft = false;
      let upstreamResponse = undefined;

      const upstreamRequest = http.request(
        {
          host: upstreamHost,
          port: upstreamPort,
          method: clientRequest.method,
          path: clientRequest.url,
          headers: {
            ...clientRequest.headers,
            host: `${upstreamHost}:${upstreamPort}`,
          },
        },
        (responseFromUpstream) => {
          upstreamResponse = responseFromUpstream;
          let responseBytes = 0;

          responseFromUpstream.on("data", (chunk) => {
            responseBytes += chunk.length;
          });
          responseFromUpstream.on("end", () => {
            upstreamResponseEnded = true;
            logProxy("upstream response ended", {
              ...context,
              elapsedMs: Date.now() - startedAt,
              status: responseFromUpstream.statusCode,
              responseBytes,
            });
            releaseGate();
          });
          responseFromUpstream.on("aborted", () => {
            logProxyError("upstream response aborted", {
              ...context,
              elapsedMs: Date.now() - startedAt,
              status: responseFromUpstream.statusCode,
              responseBytes,
            });
            releaseGate();
          });
          responseFromUpstream.on("close", () => {
            if (!upstreamResponseEnded) {
              releaseGate();
            }
          });
          responseFromUpstream.on("error", (error) => {
            if (destroyedBecauseClientLeft) {
              releaseGate();
              return;
            }

            logProxyError("upstream response error", {
              ...context,
              elapsedMs: Date.now() - startedAt,
              status: responseFromUpstream.statusCode,
              responseBytes,
              errorName: error.name,
              errorMessage: error.message,
            });
            releaseGate();
          });

          const responseHeaders = { ...responseFromUpstream.headers };
          if (runtimeEnv.FLY_MACHINE_ID) {
            responseHeaders["x-cobalt-machine-id"] = runtimeEnv.FLY_MACHINE_ID;
          }

          let statusCode = responseFromUpstream.statusCode;
          if (statusCode === undefined) {
            statusCode = 502;
          }

          clientResponse.writeHead(statusCode, responseHeaders);
          responseFromUpstream.pipe(clientResponse);
        },
      );

      const destroyUpstreamAfterClientLeft = (message) => {
        if (destroyedBecauseClientLeft) {
          return;
        }
        destroyedBecauseClientLeft = true;
        logProxyError(message, {
          ...context,
          elapsedMs: Date.now() - startedAt,
        });
        upstreamResponse?.destroy();
        upstreamRequest.destroy();
        releaseGate();
      };

      upstreamRequest.on("error", (error) => {
        if (destroyedBecauseClientLeft) {
          releaseGate();
          return;
        }

        logProxyError("upstream request error", {
          ...context,
          elapsedMs: Date.now() - startedAt,
          errorName: error.name,
          errorMessage: error.message,
        });
        releaseGate();

        if (clientResponse.headersSent) {
          clientResponse.destroy(error);
          return;
        }

        clientResponse.writeHead(502, {
          "content-type": "text/plain;charset=UTF-8",
        });
        clientResponse.end(`Cobalt upstream request failed: ${error.message}`);
      });

      clientRequest.on("aborted", () => {
        destroyUpstreamAfterClientLeft("client request aborted");
      });

      clientResponse.on("close", () => {
        if (!upstreamResponseEnded && !clientResponse.writableEnded) {
          destroyUpstreamAfterClientLeft("client response closed");
        }
      });

      clientRequest.pipe(upstreamRequest);
    };

    const acquisition = gate.acquire({
      onGranted: () => {
        queued = false;
        acquired = true;
        if (clientLeftWhileQueued) {
          // Client is already gone - release the slot immediately without doing any work.
          releaseGate();
          return;
        }
        forwardToUpstream();
      },
      onRejected: (reason) => {
        rejectWithCapacityExceeded(reason);
      },
    });

    const cancelQueuedRequest = () => {
      if (!queued || acquired) {
        return;
      }

      queued = false;
      clientLeftWhileQueued = true;
      acquisition.cancel();
      logProxyError("client aborted while queued", {
        ...context,
        gate: gate.name,
        elapsedMs: Date.now() - startedAt,
      });
    };

    if (!acquired) {
      clientRequest.on("aborted", cancelQueuedRequest);
      clientResponse.on("close", () => {
        if (!clientResponse.writableEnded) {
          cancelQueuedRequest();
        }
      });
    }
  });
};

export const startCobaltProxy = ({
  runtimeEnv = env,
  spawnProcess = spawn,
  listenPort = proxyPort,
  upstreamHost = cobaltHost,
  upstreamPort = cobaltPort,
} = {}) => {
  if (!runtimeEnv.API_URL) {
    console.error("API_URL is required for Cobalt.");
    exit(1);
  }

  const cobalt = spawnProcess("node", ["src/cobalt"], {
    stdio: "inherit",
    env: {
      ...runtimeEnv,
      API_LISTEN_ADDRESS: upstreamHost,
      API_PORT: String(upstreamPort),
    },
  });
  const server = createCobaltProxyServer({
    cobaltHost: upstreamHost,
    cobaltPort: upstreamPort,
    runtimeEnv,
  });
  let shuttingDown = false;

  const shutdown = (signal) => {
    shuttingDown = true;
    if (server.listening) {
      server.close();
    }
    cobalt.kill(signal);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  cobalt.on("exit", (code) => {
    if (shuttingDown) {
      return;
    }

    let exitCode = code;
    if (exitCode === null) {
      exitCode = 1;
    }

    console.error(`Cobalt exited with status ${exitCode}.`);
    exit(exitCode);
  });

  const waitForCobalt = () => {
    if (shuttingDown) {
      return;
    }

    const socket = net.createConnection({
      host: upstreamHost,
      port: upstreamPort,
    });

    socket.once("connect", () => {
      socket.end();

      if (shuttingDown) {
        return;
      }

      server.listen(listenPort, "0.0.0.0", () => {
        console.log(`Cobalt proxy listening on 0.0.0.0:${listenPort}.`);
      });
    });

    socket.once("error", (error) => {
      socket.destroy();

      if (shuttingDown) {
        return;
      }

      if (error.code !== "ECONNREFUSED" && error.code !== "ECONNRESET") {
        throw error;
      }

      setTimeout(waitForCobalt, 100);
    });
  };

  waitForCobalt();
  return { cobalt, server, shutdown };
};

if (argv[1] === fileURLToPath(import.meta.url)) {
  startCobaltProxy();
}
