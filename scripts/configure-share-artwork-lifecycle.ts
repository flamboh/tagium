import { spawnSync } from "node:child_process";
import { env, exit } from "node:process";
import { getShareDeploymentResources } from "./share-deployment-bindings";

const deployment = env.TAGIUM_DEPLOY_ENV;
if (deployment !== "preview" && deployment !== "production") {
  console.error(
    "TAGIUM_DEPLOY_ENV must be exactly preview or production before configuring artwork retention.",
  );
  exit(1);
}
let bucket: string;
try {
  bucket = getShareDeploymentResources(deployment).bucketName;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
}

// This bucket is dedicated to share artwork: setting the full lifecycle document is intentional.
const result = spawnSync(
  "npx",
  [
    "wrangler@4.110.0",
    "r2",
    "bucket",
    "lifecycle",
    "set",
    bucket,
    "--file",
    "migrations/share-artwork-lifecycle.json",
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) exit(result.status ?? 1);

const verification = spawnSync(
  "npx",
  ["wrangler@4.110.0", "r2", "bucket", "lifecycle", "list", bucket],
  { encoding: "utf8" },
);
const output = `${verification.stdout ?? ""}\n${verification.stderr ?? ""}`;
if (
  verification.status !== 0 ||
  !output.includes("tagium-share-artwork-expiry") ||
  !/90/.test(output)
) {
  console.error(
    "could not verify the required 90-day share-artwork lifecycle rule; refusing deployment.",
  );
  exit(1);
}
