import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";
import {
  configureShareDeploymentBindings,
  decodeWranglerConfig,
} from "./share-deployment-bindings";

const WRANGLER_CONFIG_PATH = ".output/server/wrangler.json";
const WRANGLER_VERSION = "wrangler@4.110.0";

const config = decodeWranglerConfig(JSON.parse(readFileSync(WRANGLER_CONFIG_PATH, "utf8")));
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

const upload = spawnSync(
  "npx",
  [WRANGLER_VERSION, "versions", "upload", "--config", WRANGLER_CONFIG_PATH, ...argv.slice(2)],
  {
    stdio: "inherit",
  },
);

exit(upload.status ?? 1);
