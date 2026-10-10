import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { env, exit } from "node:process";
import { Schema } from "effect";
import { getShareDeploymentResources } from "./share-deployment-bindings";

const createMigration = "migrations/0001_share_manifests.sql";

const nullableExpiryMigration = "migrations/0002_nullable_share_expiry.sql";

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

for (const migration of [createMigration, nullableExpiryMigration]) {
  if (!existsSync(migration)) {
    console.error(`required share migration is missing: ${migration}`);
    exit(1);
  }
}

const tableInfoSchema = Schema.Array(
  Schema.Struct({
    results: Schema.Array(Schema.Struct({ name: Schema.String, notnull: Schema.Number })),
  }),
);

const execute = (migration: string) => {
  const result = spawnSync(
    "npx",
    ["wrangler@4.110.0", "d1", "execute", database, "--remote", "--file", migration],
    { stdio: "inherit" },
  );

  if (result.status !== 0) exit(result.status ?? 1);
};

const expiryRequired = () => {
  const result = spawnSync(
    "npx",
    [
      "wrangler@4.110.0",
      "d1",
      "execute",
      database,
      "--remote",
      "--json",
      "--command",
      "PRAGMA table_info(share_manifests)",
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) return undefined;

  try {
    const columns = Schema.decodeUnknownSync(tableInfoSchema)(JSON.parse(result.stdout)).flatMap(
      (entry) => entry.results,
    );

    const expiry = columns.find((column) => column.name === "expires_at");

    return expiry ? expiry.notnull === 1 : undefined;
  } catch {
    return undefined;
  }
};

// Only these reviewed migrations run; do not glob this directory.
execute(createMigration);

const required = expiryRequired();

if (required === undefined) {
  console.error("could not verify share_manifests schema after migration; refusing deployment.");
  exit(1);
}

if (required) execute(nullableExpiryMigration);

if (expiryRequired() !== false) {
  console.error("could not verify nullable share_manifests.expires_at; refusing deployment.");
  exit(1);
}
