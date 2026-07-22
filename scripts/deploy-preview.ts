import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { argv, env, exit } from "node:process";
import { configureShareDeploymentBindings } from "./share-deployment-bindings";

const WRANGLER_CONFIG_PATH = ".output/server/wrangler.json";
const WRANGLER_VERSION = "wrangler@4.110.0";

type WranglerConfig = {
  vars?: Record<string, string>;
  d1_databases?: unknown[];
  r2_buckets?: unknown[];
  ratelimits?: unknown[];
};

const config = JSON.parse(readFileSync(WRANGLER_CONFIG_PATH, "utf8")) as WranglerConfig;
config.vars = {
  ...config.vars,
  TAGIUM_DEPLOY_ENV: "preview",
};
try {
  configureShareDeploymentBindings(config, "preview");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
}
writeFileSync(WRANGLER_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);

if (argv.includes("--no-upload")) {
  exit(0);
}

const prepare = (script: string) =>
  spawnSync("bun", ["run", script], {
    stdio: "inherit",
    env: { ...env, TAGIUM_DEPLOY_ENV: "preview" },
  });
for (const script of [
  "scripts/apply-share-migrations.ts",
  "scripts/configure-share-artwork-lifecycle.ts",
]) {
  const result = prepare(script);
  if (result.status !== 0) exit(result.status ?? 1);
}

const upload = spawnSync("npx", [WRANGLER_VERSION, "versions", "upload", ...argv.slice(2)], {
  stdio: "inherit",
});

exit(upload.status ?? 1);
