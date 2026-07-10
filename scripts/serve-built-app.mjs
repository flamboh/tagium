import { readFile } from "node:fs/promises";
import http from "node:http";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import worker from "../.output/server/index.mjs";

const publicRoot = resolve(".output/public");
const port = Number(process.env.PORT ?? 4173);
const contentTypes = {
  ".css": "text/css;charset=UTF-8",
  ".html": "text/html;charset=UTF-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript;charset=UTF-8",
  ".jpg": "image/jpeg",
  ".mjs": "text/javascript;charset=UTF-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

const fetchAsset = async (request) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const filePath = resolve(publicRoot, `.${pathname}`);
    if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await readFile(filePath);
    return new Response(body, {
      headers: { "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
};

const server = http.createServer(async (request, response) => {
  try {
    const origin = `http://${request.headers.host ?? `127.0.0.1:${port}`}`;
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : request;
    const workerResponse = await worker.fetch(
      new Request(new URL(request.url ?? "/", origin), {
        method: request.method,
        headers: request.headers,
        body,
        duplex: body ? "half" : undefined,
      }),
      { ASSETS: { fetch: fetchAsset } },
      { waitUntil: () => undefined },
    );

    response.writeHead(workerResponse.status, Object.fromEntries(workerResponse.headers));
    if (!workerResponse.body) {
      response.end();
      return;
    }
    Readable.fromWeb(workerResponse.body).pipe(response);
  } catch (error) {
    console.error(error);
    response.writeHead(500).end();
  }
});

server.listen(port, "127.0.0.1");
