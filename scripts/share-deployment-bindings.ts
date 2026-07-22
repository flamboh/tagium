import { env } from "node:process";

type WranglerConfig = {
  d1_databases?: unknown[];
  r2_buckets?: unknown[];
  ratelimits?: unknown[];
};

const required = (name: string) => {
  const value = env[name]?.trim();
  if (!value || /placeholder|replace[-_ ]?me/i.test(value)) {
    throw new Error(
      `${name} must name a provisioned share resource; refusing to deploy without it.`,
    );
  }
  return value;
};

export const getShareDeploymentResources = (environment: "preview" | "production") => {
  const prefix = environment === "production" ? "SHARE_" : "SHARE_PREVIEW_";
  const otherPrefix = environment === "production" ? "SHARE_PREVIEW_" : "SHARE_";
  const resources = {
    databaseId: required(`${prefix}D1_DATABASE_ID`),
    databaseName: required(`${prefix}D1_DATABASE_NAME`),
    bucketName: required(`${prefix}R2_BUCKET_NAME`),
    createRateLimitNamespace: required(`${prefix}CREATE_RATE_LIMIT_NAMESPACE_ID`),
    readRateLimitNamespace: required(`${prefix}READ_RATE_LIMIT_NAMESPACE_ID`),
    revokeRateLimitNamespace: required(`${prefix}REVOKE_RATE_LIMIT_NAMESPACE_ID`),
  };
  const isolationChecks: readonly [string, string, string | undefined][] = [
    ["D1 database", resources.databaseName, env[`${otherPrefix}D1_DATABASE_NAME`]],
    ["R2 bucket", resources.bucketName, env[`${otherPrefix}R2_BUCKET_NAME`]],
  ];
  for (const [name, value, other] of isolationChecks) {
    if (value === other?.trim())
      throw new Error(`${name} must be isolated between preview and production.`);
  }
  return resources;
};

/** Adds only deployment-time bindings, keeping preview and production isolated. */
export const configureShareDeploymentBindings = (
  config: WranglerConfig,
  environment: "preview" | "production",
) => {
  const {
    databaseId,
    databaseName,
    bucketName,
    createRateLimitNamespace,
    readRateLimitNamespace,
    revokeRateLimitNamespace,
  } = getShareDeploymentResources(environment);
  config.d1_databases = [
    ...(config.d1_databases ?? []).filter(
      (binding) =>
        !(
          binding &&
          typeof binding === "object" &&
          (binding as { binding?: string }).binding === "SHARE_MANIFESTS"
        ),
    ),
    { binding: "SHARE_MANIFESTS", database_id: databaseId, database_name: databaseName },
  ];
  config.r2_buckets = [
    ...(config.r2_buckets ?? []).filter(
      (binding) =>
        !(
          binding &&
          typeof binding === "object" &&
          (binding as { binding?: string }).binding === "SHARE_ARTWORK"
        ),
    ),
    { binding: "SHARE_ARTWORK", bucket_name: bucketName },
  ];
  const shareRateLimits = [
    {
      name: "SHARE_CREATE_RATE_LIMITER",
      namespace_id: createRateLimitNamespace,
      simple: { limit: 10, period: 60 },
    },
    {
      name: "SHARE_READ_RATE_LIMITER",
      namespace_id: readRateLimitNamespace,
      simple: { limit: 120, period: 60 },
    },
    {
      name: "SHARE_REVOKE_RATE_LIMITER",
      namespace_id: revokeRateLimitNamespace,
      simple: { limit: 20, period: 60 },
    },
  ];
  config.ratelimits = [
    ...(config.ratelimits ?? []).filter(
      (binding) =>
        !(
          binding &&
          typeof binding === "object" &&
          [
            "SHARE_CREATE_RATE_LIMITER",
            "SHARE_READ_RATE_LIMITER",
            "SHARE_REVOKE_RATE_LIMITER",
          ].includes((binding as { name?: string }).name ?? "")
        ),
    ),
    ...shareRateLimits,
  ];
};
