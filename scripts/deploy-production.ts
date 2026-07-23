import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { configureShareDeploymentBindings } from "./share-deployment-bindings";

const WRANGLER_CONFIG_PATH = ".output/server/wrangler.json";
const WRANGLER_VERSION = "wrangler@4.110.0";

type WranglerConfig = {
  name?: string;
  vars?: Record<string, string>;
  d1_databases?: unknown[];
  r2_buckets?: unknown[];
  ratelimits?: unknown[];
};

const config = JSON.parse(readFileSync(WRANGLER_CONFIG_PATH, "utf8")) as WranglerConfig;
try {
  configureShareDeploymentBindings(config, "production");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
}
writeFileSync(WRANGLER_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);

if (argv.includes("--no-upload")) {
  exit(0);
}

const deploy = spawnSync(
  "npx",
  [WRANGLER_VERSION, "deploy", "--config", WRANGLER_CONFIG_PATH, ...argv.slice(2)],
  { stdio: "inherit" },
);

exit(deploy.status ?? 1);
