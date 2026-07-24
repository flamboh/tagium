import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { env, exit } from "node:process";
import { getShareDeploymentResources } from "./share-deployment-bindings";

const migration = "migrations/0001_share_manifests.sql";
const deployment = env.TAGIUM_DEPLOY_ENV;

if (deployment !== "preview" && deployment !== "production") {
  console.error(
    "TAGIUM_DEPLOY_ENV must be exactly preview or production before applying share migrations.",
  );
  exit(1);
}

let database: string;
try {
  database = getShareDeploymentResources(deployment).databaseName;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
}
if (!existsSync(migration)) {
  console.error(`required share migration is missing: ${migration}`);
  exit(1);
}

// This intentionally executes only the reviewed, additive first share-schema migration.
// Future migrations require their own explicit command and review; do not glob this directory.
const result = spawnSync(
  "npx",
  ["wrangler@4.110.0", "d1", "execute", database, "--remote", "--file", migration],
  { stdio: "inherit" },
);
if (result.status !== 0) exit(result.status ?? 1);

const verification = spawnSync(
  "npx",
  [
    "wrangler@4.110.0",
    "d1",
    "execute",
    database,
    "--remote",
    "--json",
    "--command",
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'share_manifests'",
  ],
  { encoding: "utf8" },
);
if (verification.status !== 0 || !verification.stdout.includes("share_manifests")) {
  console.error("could not verify share_manifests schema after migration; refusing deployment.");
  exit(1);
}
