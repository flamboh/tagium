import { defineNitroConfig } from "nitro/config";

const wrangler = {
  keep_vars: true,
  workers_dev: false,
  preview_urls: true,
  routes: [
    { pattern: "tagium.app", custom_domain: true },
    { pattern: "save.tagium.app", custom_domain: true },
    { pattern: "www.tagium.app", custom_domain: true },
    { pattern: "tagium.oli.boo", custom_domain: true },
  ],
  vars: {
    COBALT_API_URL: "https://tagium-cobalt.fly.dev/",
    TAGIUM_DEPLOY_ENV: "production",
    SENTRY_DSN:
      "https://4e610dc86e5ffd151308b361352a1342@o4511707616182272.ingest.us.sentry.io/4511707631124480",
  },
  ratelimits: [
    {
      name: "COBALT_SESSION_RATE_LIMITER",
      namespace_id: "1042701",
      simple: { limit: 20, period: 60 },
    },
    {
      name: "COBALT_CLIENT_RATE_LIMITER",
      namespace_id: "1042702",
      simple: { limit: 60, period: 60 },
    },
    {
      name: "SOUNDCLOUD_SESSION_RATE_LIMITER",
      namespace_id: "1042703",
      simple: { limit: 60, period: 60 },
    },
    {
      name: "SOUNDCLOUD_CLIENT_RATE_LIMITER",
      namespace_id: "1042704",
      simple: { limit: 120, period: 60 },
    },
    {
      name: "LYRICS_SESSION_RATE_LIMITER",
      namespace_id: "1042705",
      simple: { limit: 120, period: 60 },
    },
    {
      name: "LYRICS_CLIENT_RATE_LIMITER",
      namespace_id: "1042706",
      simple: { limit: 240, period: 60 },
    },
  ],
};

export default defineNitroConfig({
  compatibilityDate: "2026-04-08",
  serverDir: "server",
  preset: "cloudflare_module",
  cloudflare: {
    deployConfig: true,
    nodeCompat: true,
    wrangler,
  },
});
