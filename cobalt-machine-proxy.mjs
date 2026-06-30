import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { env, exit } from "node:process";

const proxyPort = 9000;
const cobaltHost = "127.0.0.1";
const cobaltPort = 9001;
let nextRequestId = 0;

if (!env.API_URL) {
  console.error("API_URL is required for Cobalt.");
  exit(1);
}

const cobalt = spawn("node", ["src/cobalt"], {
  stdio: "inherit",
  env: {
    ...env,
    API_LISTEN_ADDRESS: cobaltHost,
    API_PORT: String(cobaltPort),
  },
});

let shuttingDown = false;

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

const getRequestContext = (clientRequest, requestId) => {
  const requestUrl = new URL(clientRequest.url ?? "/", "http://tagium-cobalt.local");
  const context = {
    event: "cobalt_proxy_request",
    requestId,
    machineId: env.FLY_MACHINE_ID,
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

const server = http.createServer((clientRequest, clientResponse) => {
  const requestId = getProxyRequestId(clientRequest);
  const startedAt = Date.now();
  const context = getRequestContext(clientRequest, requestId);

  const upstreamRequest = http.request(
    {
      host: cobaltHost,
      port: cobaltPort,
      method: clientRequest.method,
      path: clientRequest.url,
      headers: {
        ...clientRequest.headers,
        host: `${cobaltHost}:${cobaltPort}`,
      },
    },
    (upstreamResponse) => {
      let responseBytes = 0;
      upstreamResponse.on("data", (chunk) => {
        responseBytes += chunk.length;
      });
      upstreamResponse.on("end", () => {
        logProxy("upstream response ended", {
          ...context,
          elapsedMs: Date.now() - startedAt,
          status: upstreamResponse.statusCode,
          responseBytes,
        });
      });
      upstreamResponse.on("aborted", () => {
        logProxyError("upstream response aborted", {
          ...context,
          elapsedMs: Date.now() - startedAt,
          status: upstreamResponse.statusCode,
          responseBytes,
        });
      });
      upstreamResponse.on("error", (error) => {
        logProxyError("upstream response error", {
          ...context,
          elapsedMs: Date.now() - startedAt,
          status: upstreamResponse.statusCode,
          responseBytes,
          errorName: error.name,
          errorMessage: error.message,
        });
      });

      const responseHeaders = { ...upstreamResponse.headers };
      if (env.FLY_MACHINE_ID) {
        responseHeaders["x-cobalt-machine-id"] = env.FLY_MACHINE_ID;
      }

      let statusCode = upstreamResponse.statusCode;
      if (statusCode === undefined) {
        statusCode = 502;
      }

      clientResponse.writeHead(statusCode, responseHeaders);
      upstreamResponse.pipe(clientResponse);
    },
  );

  upstreamRequest.on("error", (error) => {
    logProxyError("upstream request error", {
      ...context,
      elapsedMs: Date.now() - startedAt,
      errorName: error.name,
      errorMessage: error.message,
    });

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
    logProxyError("client request aborted", {
      ...context,
      elapsedMs: Date.now() - startedAt,
    });
    upstreamRequest.destroy();
  });

  clientRequest.pipe(upstreamRequest);
});

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
    host: cobaltHost,
    port: cobaltPort,
  });

  socket.once("connect", () => {
    socket.end();

    if (shuttingDown) {
      return;
    }

    server.listen(proxyPort, "0.0.0.0", () => {
      console.log(`Cobalt proxy listening on 0.0.0.0:${proxyPort}.`);
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
