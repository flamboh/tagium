import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";

const WRANGLER_CONFIG_PATH = ".output/server/wrangler.json";

type WranglerConfig = {
  vars?: Record<string, string>;
};

const config = JSON.parse(readFileSync(WRANGLER_CONFIG_PATH, "utf8")) as WranglerConfig;
config.vars = {
  ...config.vars,
  TAGIUM_DEPLOY_ENV: "preview",
};
writeFileSync(WRANGLER_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);

if (argv.includes("--no-upload")) {
  exit(0);
}

const upload = spawnSync("npx", ["wrangler", "versions", "upload"], {
  stdio: "inherit",
});

exit(upload.status ?? 1);
