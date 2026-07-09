import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const WRANGLER_CONFIG_PATH = ".output/server/wrangler.json";

type WranglerConfig = {
  vars?: Record<string, string>;
};

const config = JSON.parse(readFileSync(WRANGLER_CONFIG_PATH, "utf8")) as WranglerConfig;
if (config.vars?.TAGIUM_DEPLOY_ENV !== "production") {
  console.error(
    `refusing production deploy: TAGIUM_DEPLOY_ENV is ${JSON.stringify(config.vars?.TAGIUM_DEPLOY_ENV)}.`,
  );
  exit(1);
}

const deploy = spawnSync(
  "npx",
  ["wrangler", "deploy", "--config", WRANGLER_CONFIG_PATH, ...argv.slice(2)],
  { stdio: "inherit" },
);

exit(deploy.status ?? 1);
