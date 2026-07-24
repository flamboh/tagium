import { spawnSync } from "node:child_process";
import { env, exit } from "node:process";

const branch = env.WORKERS_CI_BRANCH ?? "";
const deployEnv = branch === "main" || branch === "master" ? "production" : "preview";
const releaseSha =
  env.WORKERS_CI_COMMIT_SHA ?? env.CF_PAGES_COMMIT_SHA ?? env.GITHUB_SHA ?? "local";

const result = spawnSync("bun", ["run", "build"], {
  stdio: "inherit",
  env: {
    ...env,
    VITE_PUBLIC_DEPLOY_ENV: deployEnv,
    VITE_PUBLIC_RELEASE_SHA: releaseSha,
    VITE_PUBLIC_SHARE_LINKS_ENABLED: "true",
  },
});
exit(result.status ?? 1);
