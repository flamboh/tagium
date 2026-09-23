import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Docker from "alchemy/Docker";
import * as Fly from "alchemy/Fly";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { Buffer } from "node:buffer";

const productionStages = new Set(["prod", "production"]);
const shareArtworkRetentionSeconds = 90 * 24 * 60 * 60;
const flyRegistry = "registry.fly.io";
const cobaltAppNamePattern = /^tagium-cobalt-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const cobaltProxyPort = 9000;

const cobaltEnv = {
  CUSTOM_INNERTUBE_CLIENT: "WEB_EMBEDDED",
  YOUTUBE_GENERATE_PO_TOKENS: "0",
  RATELIMIT_WINDOW: "60",
  RATELIMIT_MAX: "1000",
  TUNNEL_RATELIMIT_WINDOW: "60",
  TUNNEL_RATELIMIT_MAX: "2000",
  PROXY_MAX_QUEUED_RESOLVE: "96",
  PROXY_MAX_QUEUED_TUNNEL: "192",
  PROXY_MAX_QUEUE_WAIT_MS: "30000",
  PROXY_DRAIN_TIMEOUT_MS: "270000",
  API_AUTH_REQUIRED: "1",
};

const rateLimit = (name: string, namespaceId: string, limit: number) =>
  Cloudflare.RateLimit(name, { namespaceId, simple: { limit, period: 60 } });

const cobaltAppName = (stage: string) =>
  Effect.gen(function* () {
    const name = `tagium-cobalt-${stage.toLowerCase()}`;
    if (!cobaltAppNamePattern.test(name) || name.length > 30) {
      return yield* Effect.die(
        new Error(
          `stage ${stage} cannot name a fly app: ${name} must be at most 30 lowercase letters, digits, or hyphens`,
        ),
      );
    }
    return name;
  });

const toUuid = (hex: string) =>
  [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join(
    "-",
  );

const toCobaltKeysUrl = (apiKey: Redacted.Redacted<string>) =>
  `data:application/json;base64,${Buffer.from(
    JSON.stringify({ [Redacted.value(apiKey)]: { name: "tagium-worker" } }),
  ).toString("base64")}`;

const requireDigest = (repoDigest: string | undefined) => {
  if (!repoDigest) {
    throw new Error("the cobalt image push did not report a registry digest");
  }
  return repoDigest;
};

export default Alchemy.Stack(
  "tagium",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Fly.providers(), Docker.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    if (productionStages.has(stage.toLowerCase())) {
      return yield* Effect.die(
        new Error(
          `refusing stage ${stage}: production still deploys through wrangler, workers builds, and flyctl`,
        ),
      );
    }

    const cobaltApp = yield* Fly.App("Cobalt", {
      name: yield* cobaltAppName(stage),
      orgSlug: Config.String("FLY_ORG"),
    });
    yield* Fly.IpAssignment("CobaltSharedIpv4", { app: cobaltApp, type: "shared_v4" });
    yield* Fly.IpAssignment("CobaltIpv6", { app: cobaltApp, type: "v6" });

    const cobaltImage = yield* Docker.Image("CobaltImage", {
      name: Output.interpolate`${flyRegistry}/${cobaltApp.appName}`,
      registry: {
        server: flyRegistry,
        username: "x",
        password: Config.Redacted("FLY_API_TOKEN"),
      },
      build: { context: ".", dockerfile: "Dockerfile.cobalt", platform: "linux/amd64" },
    });

    const cobaltApiKey = Output.map(
      yield* Alchemy.makeRandom("CobaltApiKey", { bytes: 16 }),
      (seed) => Redacted.make(toUuid(Redacted.value(seed))),
    );
    const cobaltUrl = Output.interpolate`${cobaltApp.url}/`;

    yield* Fly.Machine("CobaltMachine", {
      app: cobaltApp,
      region: "lax",
      count: Config.Int("COBALT_MACHINE_COUNT").pipe(Config.withDefault(1)),
      image: Output.map(cobaltImage.repoDigest, requireDigest),
      init: { cmd: ["node", "/app/cobalt-machine-proxy.mjs"] },
      guest: { cpuKind: "shared", cpus: 1, memoryMb: 1024 },
      env: {
        ...cobaltEnv,
        API_URL: cobaltUrl,
        API_KEY_URL: Output.map(cobaltApiKey, toCobaltKeysUrl),
      },
      services: [
        {
          protocol: "tcp",
          internalPort: cobaltProxyPort,
          ports: [
            { port: 80, handlers: ["http"], forceHttps: true },
            { port: 443, handlers: ["tls", "http"] },
          ],
          autostart: true,
          autostop: "suspend",
          minMachinesRunning: 0,
          checks: [
            {
              type: "http",
              port: cobaltProxyPort,
              method: "GET",
              path: "/readyz",
              gracePeriod: "30s",
              interval: "15s",
              timeout: "2s",
              headers: [{ name: "X-Forwarded-Proto", values: ["https"] }],
            },
          ],
        },
      ],
      deploy: { strategy: "rolling", healthTimeout: "2 minutes" },
      shutdown: { signal: "SIGTERM", timeout: "300 seconds" },
    });

    const shareManifests = yield* Cloudflare.D1.Database("ShareManifests", {
      migrations: "migrations",
    });
    const shareArtwork = yield* Cloudflare.R2.Bucket("ShareArtwork", {
      forceDestroy: true,
      lifecycleRules: [
        {
          id: "tagium-share-artwork-expiry",
          enabled: true,
          prefix: "shares/",
          deleteObjectsTransition: {
            condition: { type: "Age", maxAge: shareArtworkRetentionSeconds },
          },
        },
      ],
    });
    const cobaltMachineAffinitySecret = yield* Alchemy.makeRandom("CobaltMachineAffinitySecret");

    const app = yield* Cloudflare.Worker("App", {
      main: ".output/server/index.mjs",
      bundle: false,
      assets: ".output/public",
      compatibility: { date: "2026-04-08", flags: ["nodejs_compat"] },
      observability: {
        enabled: false,
        headSamplingRate: 1,
        logs: { enabled: true, headSamplingRate: 1, persist: true, invocationLogs: true },
        traces: { enabled: false, persist: true, headSamplingRate: 1 },
      },
      env: {
        COBALT_API_URL: cobaltUrl,
        COBALT_API_KEY: cobaltApiKey,
        COBALT_MACHINE_AFFINITY_SECRET: cobaltMachineAffinitySecret,
        TAGIUM_DEPLOY_ENV: "preview",
        SHARE_MANIFESTS: shareManifests,
        SHARE_ARTWORK: shareArtwork,
        COBALT_SESSION_RATE_LIMITER: rateLimit("COBALT_SESSION_RATE_LIMITER", "128300001", 20),
        COBALT_CLIENT_RATE_LIMITER: rateLimit("COBALT_CLIENT_RATE_LIMITER", "128300002", 60),
        SHARE_CREATE_RATE_LIMITER: rateLimit("SHARE_CREATE_RATE_LIMITER", "128300003", 10),
        SHARE_READ_RATE_LIMITER: rateLimit("SHARE_READ_RATE_LIMITER", "128300004", 120),
        SHARE_REVOKE_RATE_LIMITER: rateLimit("SHARE_REVOKE_RATE_LIMITER", "128300005", 20),
        SHARE_UPDATE_RATE_LIMITER: rateLimit("SHARE_UPDATE_RATE_LIMITER", "128300006", 20),
      },
    });

    return { url: app.url, cobaltUrl: cobaltApp.url };
  }),
);
