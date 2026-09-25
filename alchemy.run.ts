import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

const productionStages = new Set(["prod", "production"]);
const shareArtworkRetentionSeconds = 90 * 24 * 60 * 60;

const rateLimit = (name: string, namespaceId: string, limit: number) =>
  Cloudflare.RateLimit(name, { namespaceId, simple: { limit, period: 60 } });

export default Alchemy.Stack(
  "tagium",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    if (productionStages.has(stage.toLowerCase())) {
      return yield* Effect.die(
        new Error(
          `refusing stage ${stage}: production still deploys through wrangler and workers builds`,
        ),
      );
    }

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
        COBALT_API_URL: "https://tagium-cobalt.fly.dev/",
        COBALT_API_KEY: Config.Redacted("COBALT_API_KEY"),
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

    return { url: app.url };
  }),
);
