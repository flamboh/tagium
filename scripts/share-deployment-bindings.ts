export type DeployEnvironment = "preview" | "production";

/** Stable, provisioned Cloudflare resources. Keep this as the sole target map. */
export const SHARE_DEPLOYMENT_RESOURCES = {
  preview: {
    deployEnv: "preview",
    databaseId: "dcca5842-a2a2-48a1-b130-7aee831ad1b5",
    databaseName: "tagium-share-manifests-preview",
    bucketName: "tagium-share-artwork-preview",
    createRateLimitNamespace: "128100001",
    readRateLimitNamespace: "128100002",
    revokeRateLimitNamespace: "128100003",
    updateRateLimitNamespace: "128100004",
  },
  production: {
    deployEnv: "production",
    databaseId: "8d393f39-1df1-48f9-b249-4b3a116b6c49",
    databaseName: "tagium-share-manifests-production",
    bucketName: "tagium-share-artwork-production",
    createRateLimitNamespace: "128200001",
    readRateLimitNamespace: "128200002",
    revokeRateLimitNamespace: "128200003",
    updateRateLimitNamespace: "128200004",
  },
} as const;

export const getShareDeploymentResources = (environment: DeployEnvironment) =>
  SHARE_DEPLOYMENT_RESOURCES[environment];

export type WranglerConfig = {
  name?: string;
  vars?: Record<string, string>;
  d1_databases?: unknown[];
  r2_buckets?: unknown[];
  ratelimits?: unknown[];
  env?: unknown;
};

/** Materialize one target into the top-level config used by both Wrangler commands. */
export const configureShareDeploymentBindings = (
  config: WranglerConfig,
  environment: DeployEnvironment,
) => {
  if (config.name !== "tagium")
    throw new Error(
      `refusing deploy: Worker name must be tagium, got ${JSON.stringify(config.name)}`,
    );
  if (config.env != null)
    throw new Error("refusing deploy: generated config must not contain Wrangler env arrays");
  const resources = getShareDeploymentResources(environment);
  config.vars = { ...config.vars, TAGIUM_DEPLOY_ENV: resources.deployEnv };
  config.d1_databases = [
    {
      binding: "SHARE_MANIFESTS",
      database_id: resources.databaseId,
      database_name: resources.databaseName,
    },
  ];
  config.r2_buckets = [{ binding: "SHARE_ARTWORK", bucket_name: resources.bucketName }];
  const shareRateLimits = [
    {
      name: "SHARE_CREATE_RATE_LIMITER",
      namespace_id: resources.createRateLimitNamespace,
      simple: { limit: 10, period: 60 },
    },
    {
      name: "SHARE_READ_RATE_LIMITER",
      namespace_id: resources.readRateLimitNamespace,
      simple: { limit: 120, period: 60 },
    },
    {
      name: "SHARE_REVOKE_RATE_LIMITER",
      namespace_id: resources.revokeRateLimitNamespace,
      simple: { limit: 20, period: 60 },
    },
    {
      name: "SHARE_UPDATE_RATE_LIMITER",
      namespace_id: resources.updateRateLimitNamespace,
      simple: { limit: 20, period: 60 },
    },
  ];
  const cobalt = (config.ratelimits ?? []).filter(
    (binding) =>
      binding &&
      typeof binding === "object" &&
      ["COBALT_SESSION_RATE_LIMITER", "COBALT_CLIENT_RATE_LIMITER"].includes(
        (binding as { name?: string }).name ?? "",
      ),
  );
  config.ratelimits = [...cobalt, ...shareRateLimits];
  return config;
};
