import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  compatibilityDate: "2026-04-08",
  serverDir: "server",
  preset: "cloudflare_module",
  cloudflare: {
    deployConfig: true,
    nodeCompat: true,
    wrangler: {
      keep_vars: true,
      vars: {
        COBALT_API_URL: "https://tagium-cobalt.fly.dev/",
      },
    },
  },
});
