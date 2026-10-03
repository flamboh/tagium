import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createWriteStream, readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import {
  Miniflare,
  Response as MiniflareResponse,
  type Request as MiniflareRequest,
} from "miniflare";
import {
  configureShareDeploymentBindings,
  decodeWranglerConfig,
} from "../../../scripts/share-deployment-bindings.ts";
import { handleUpstream } from "./fakes/router.ts";
import {
  E2E_BASE_URL,
  E2E_CONTROL_PORT,
  E2E_CONTROL_URL,
  E2E_PORT,
  FAKE_COBALT_API_KEY,
  FAKE_COBALT_ORIGIN,
  FAKE_POSTHOG_KEY,
  FAKE_POSTHOG_ORIGIN,
  type CobaltBehavior,
  type RateLimitRule,
  type Scenario,
  type Sequence,
  type TunnelBehavior,
} from "./protocol.ts";
import { createRegistry, ScenarioConflictError } from "./registry.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const outputDir = join(root, ".output");
const serverDir = join(outputDir, "server");
const logPath = join(tmpdir(), `tagium-e2e-harness-${E2E_PORT}.log`);

if (process.env.E2E_SKIP_BUILD !== "1") {
  console.log("[e2e] building app with vp build");
  const build = spawnSync(join(root, "node_modules/.bin/vp"), ["build"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_PUBLIC_DEPLOY_ENV: "production",
      VITE_PUBLIC_RELEASE_SHA: "e2e",
      VITE_PUBLIC_SHARE_LINKS_ENABLED: "true",
      VITE_PUBLIC_POSTHOG_KEY: FAKE_POSTHOG_KEY,
      VITE_PUBLIC_POSTHOG_HOST: FAKE_POSTHOG_ORIGIN,
    },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const wrangler = configureShareDeploymentBindings(
  decodeWranglerConfig(JSON.parse(readFileSync(join(serverDir, "wrangler.json"), "utf8"))),
  "production",
);
const { SENTRY_DSN: _sentryDsn, ...productionVars } = wrangler.vars ?? {};
const rateLimiterNames = (wrangler.ratelimits ?? []).flatMap((binding) =>
  binding.name ? [binding.name] : [],
);
const decodeBinding = Schema.decodeUnknownSync(Schema.Struct({ binding: Schema.String }));
const localResources = (bindings: readonly unknown[] | undefined) =>
  Object.fromEntries(
    (bindings ?? []).map((entry) => {
      const { binding } = decodeBinding(entry);
      return [binding, `${binding.toLowerCase()}-e2e`];
    }),
  );

const listModules = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listModules(path);
    return [".mjs", ".js", ".wasm"].includes(extname(entry.name)) ? [path] : [];
  });
const entrypoint = join(serverDir, typeof wrangler.main === "string" ? wrangler.main : "index.mjs");
const modules = [entrypoint, ...listModules(serverDir).filter((path) => path !== entrypoint)].map(
  (path) => ({
    type: extname(path) === ".wasm" ? ("CompiledWasm" as const) : ("ESModule" as const),
    path,
  }),
);

const registry = createRegistry();
const log = createWriteStream(logPath, { flags: "w" });

const toFetchRequest = async (request: MiniflareRequest) =>
  new Request(request.url, {
    method: request.method,
    headers: [...request.headers],
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
  });

async function* streamBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return;
      yield chunk.value;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const toMiniflareResponse = (response: Response) =>
  new MiniflareResponse(
    response.status === 204 || response.status === 304 || !response.body
      ? null
      : streamBody(response.body),
    { status: response.status, headers: [...response.headers] },
  );

const RATE_LIMIT_SHIM = `
export default function (env) {
  return {
    async limit({ key }) {
      const response = await env.CONTROL.fetch("http://control/ratelimit", {
        method: "POST",
        body: JSON.stringify({ binding: env.binding, key }),
      });
      if (!response.ok) throw new Error("rate limiter unavailable");
      return response.json();
    },
  };
}
`;

const miniflare = new Miniflare({
  host: "127.0.0.1",
  port: E2E_PORT,
  handleRuntimeStdio(stdout: Readable, stderr: Readable) {
    stdout.pipe(log);
    stderr.pipe(log);
  },
  workers: [
    {
      name: wrangler.name ?? "tagium",
      modules,
      modulesRoot: serverDir,
      compatibilityDate: String(wrangler.compatibility_date),
      compatibilityFlags: (wrangler.compatibility_flags as string[] | undefined) ?? [],
      assets: {
        directory: join(outputDir, "public"),
        binding: "ASSETS",
        routerConfig: { has_user_worker: true },
      },
      bindings: {
        ...productionVars,
        COBALT_API_URL: `${FAKE_COBALT_ORIGIN}/`,
        COBALT_API_KEY: FAKE_COBALT_API_KEY,
        COBALT_MACHINE_AFFINITY_SECRET: "e2e-machine-affinity-secret",
      },
      d1Databases: localResources(wrangler.d1_databases),
      r2Buckets: localResources(wrangler.r2_buckets),
      wrappedBindings: Object.fromEntries(
        rateLimiterNames.map((name) => [
          name,
          { scriptName: "e2e-rate-limiter", bindings: { binding: name } },
        ]),
      ),
      outboundService: async (request: MiniflareRequest) =>
        toMiniflareResponse(
          await handleUpstream(registry, "worker", await toFetchRequest(request)),
        ),
    },
    {
      name: "e2e-rate-limiter",
      modules: true,
      script: RATE_LIMIT_SHIM,
      serviceBindings: {
        CONTROL: async (request: MiniflareRequest) => {
          const { binding, key } = (await request.json()) as { binding: string; key: string };
          const result = registry.consumeRateLimit(binding, key);
          return result === "unavailable"
            ? new MiniflareResponse("unavailable", { status: 503 })
            : MiniflareResponse.json({ success: result });
        },
      },
    },
  ],
});

await miniflare.ready;

const database = await miniflare.getD1Database("SHARE_MANIFESTS");
const migrationsDir = join(root, "migrations");
for (const file of readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const statements = readFileSync(join(migrationsDir, file), "utf8")
    .replace(/^\s*--.*$/gmu, "")
    .split(/;\s*$/mu)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await database.prepare(statement).run();
}

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

const send = async (response: ServerResponse, result: Response) => {
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(Buffer.from(await result.arrayBuffer()));
};

type ControlBody = {
  owner: string;
  scenarios?: Scenario[];
  key?: string;
  cobalt?: Sequence<CobaltBehavior>;
  tunnel?: Sequence<TunnelBehavior>;
  rule?: RateLimitRule;
};

const control = async (request: IncomingMessage, raw: Buffer): Promise<Response> => {
  const url = new URL(request.url ?? "/", E2E_CONTROL_URL);
  if (request.method === "GET" && url.pathname === "/health") return Response.json({ ok: true });

  if (request.method === "POST" && url.pathname === "/browser-upstream") {
    const target = request.headers["x-e2e-url"];
    const method = String(request.headers["x-e2e-method"] ?? "GET");
    if (typeof target !== "string") return new Response("missing x-e2e-url", { status: 400 });
    const owner = request.headers["x-e2e-owner"];
    return handleUpstream(
      registry,
      "browser",
      new Request(target, {
        method,
        body: method === "GET" || method === "HEAD" ? undefined : new Uint8Array(raw),
      }),
      typeof owner === "string" ? owner : null,
    );
  }

  if (request.method === "GET" && url.pathname === "/calls") {
    const since = url.searchParams.get("since");
    const unexpected = url.searchParams.get("unexpected");
    return Response.json(
      registry.calls({
        owner: url.searchParams.get("owner") ?? undefined,
        includeUnowned: url.searchParams.get("includeUnowned") === "1",
        since: since ? Number(since) : undefined,
        unexpected: unexpected === null ? undefined : unexpected === "1",
      }),
    );
  }

  const body = JSON.parse(raw.toString() || "{}") as ControlBody;
  if (request.method === "POST" && url.pathname === "/scenarios") {
    registry.register(body.owner, body.scenarios ?? []);
  } else if (request.method === "POST" && url.pathname === "/overrides" && body.key) {
    if (body.cobalt) registry.overrideCobalt(body.owner, body.key, body.cobalt);
    if (body.tunnel) registry.overrideTunnel(body.owner, body.key, body.tunnel);
  } else if (request.method === "POST" && url.pathname === "/rate-limits" && body.rule) {
    registry.limitRate(body.owner, body.rule);
  } else if (request.method === "POST" && url.pathname === "/release") {
    registry.release(body.owner);
  } else {
    return new Response("not found", { status: 404 });
  }
  return new Response(null, { status: 204 });
};

const controlServer = createServer(async (request, response) => {
  try {
    await send(response, await control(request, await readBody(request)));
  } catch (error) {
    const status = error instanceof ScenarioConflictError ? 409 : 500;
    await send(
      response,
      new Response(error instanceof Error ? error.message : String(error), { status }),
    );
  }
});
controlServer.listen(E2E_CONTROL_PORT, "127.0.0.1");

console.log(`[e2e] app ${E2E_BASE_URL}  control ${E2E_CONTROL_URL}  worker log ${logPath}`);

const shutdown = async () => {
  controlServer.close();
  await miniflare.dispose();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
