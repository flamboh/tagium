import { spawnSync } from "node:child_process";
import { argv, env, exit } from "node:process";
import { SHARE_SLUG_PATTERN } from "../server/utils/share-manifest";
import { disableShareThenDeleteArtwork } from "../server/utils/share-manifest-maintenance";
import { getShareDeploymentResources } from "./share-deployment-bindings";

const [slug] = argv.slice(2);
const deployment = env.TAGIUM_DEPLOY_ENV;
if (
  (deployment !== "preview" && deployment !== "production") ||
  env.SHARE_MAINTAINER_CONFIRM !== "disable" ||
  !slug ||
  !SHARE_SLUG_PATTERN.test(slug)
) {
  console.error(
    "usage: TAGIUM_DEPLOY_ENV=preview|production SHARE_MAINTAINER_CONFIRM=disable bun run disable:share-manifest -- <22-char-slug>",
  );
  exit(1);
}

let resources: ReturnType<typeof getShareDeploymentResources>;
try {
  resources = getShareDeploymentResources(deployment);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
}
const wrangler = (args: string[]) =>
  spawnSync("npx", ["wrangler@4.110.0", ...args], { encoding: "utf8" });
const quotedSlug = slug.replaceAll("'", "''");
const lookup = wrangler([
  "d1",
  "execute",
  resources.databaseName,
  "--remote",
  "--json",
  "--command",
  `SELECT slug, artwork_key FROM share_manifests WHERE slug = '${quotedSlug}'`,
]);
if (lookup.status !== 0) exit(lookup.status ?? 1);
let artworkKey: string | undefined;
let found = false;
try {
  const payload = JSON.parse(lookup.stdout) as Array<{
    results?: Array<{ slug?: string; artwork_key?: string | null }>;
  }>;
  const record = payload.flatMap((entry) => entry.results ?? [])[0];
  found = record?.slug === slug;
  artworkKey = record?.artwork_key ?? undefined;
} catch {
  console.error("could not parse D1 lookup response; no change was made.");
  exit(1);
}

const result = await disableShareThenDeleteArtwork({
  disable: async () => {
    const update = wrangler([
      "d1",
      "execute",
      resources.databaseName,
      "--remote",
      "--command",
      `UPDATE share_manifests SET status = 'disabled' WHERE slug = '${quotedSlug}'`,
    ]);
    if (update.status !== 0) throw new Error("D1 disable failed");
    return { found, artworkKey };
  },
  deleteArtwork: async (key) => {
    // Keys are server-derived; refuse a corrupt row rather than deleting arbitrary R2 content.
    if (!key.startsWith(`shares/${slug}/`)) throw new Error("unexpected artwork key");
    const deleted = wrangler(["r2", "object", "delete", resources.bucketName, key]);
    if (deleted.status !== 0) throw new Error("R2 deletion failed");
  },
});
if (result === "artwork_delete_failed") {
  console.error(
    "manifest disabled, but artwork deletion failed; rerun the same command after R2 recovers.",
  );
  exit(1);
}
console.log(
  result === "not_found"
    ? "manifest was already absent"
    : "manifest disabled and artwork deletion completed",
);
