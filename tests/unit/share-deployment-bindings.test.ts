import { describe, expect, it } from "vitest";
import {
  SHARE_DEPLOYMENT_RESOURCES,
  configureShareDeploymentBindings,
  type WranglerConfig,
} from "../../scripts/share-deployment-bindings";

describe("share deployment config contract", () => {
  it.each(["preview", "production"] as const)("materializes %s at the top level", (environment) => {
    const config: WranglerConfig & { routes: unknown[] } = {
      name: "tagium",
      vars: { COBALT_API_URL: "https://tagium-cobalt.fly.dev/" },
      routes: [{ pattern: "tagium.app", custom_domain: true }],
      ratelimits: [
        { name: "COBALT_SESSION_RATE_LIMITER", namespace_id: "1042701" },
        { name: "COBALT_CLIENT_RATE_LIMITER", namespace_id: "1042702" },
      ],
    };
    configureShareDeploymentBindings(config, environment);
    const target = SHARE_DEPLOYMENT_RESOURCES[environment];
    expect(config.name).toBe("tagium");
    expect(config.env).toBeUndefined();
    expect(config.vars).toMatchObject({
      COBALT_API_URL: "https://tagium-cobalt.fly.dev/",
      TAGIUM_DEPLOY_ENV: environment,
    });
    expect(config.d1_databases).toEqual([
      {
        binding: "SHARE_MANIFESTS",
        database_id: target.databaseId,
        database_name: target.databaseName,
      },
    ]);
    expect(config.r2_buckets).toEqual([
      { binding: "SHARE_ARTWORK", bucket_name: target.bucketName },
    ]);
    expect(config.ratelimits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "COBALT_SESSION_RATE_LIMITER" }),
        expect.objectContaining({ name: "COBALT_CLIENT_RATE_LIMITER" }),
        expect.objectContaining({
          name: "SHARE_CREATE_RATE_LIMITER",
          namespace_id: target.createRateLimitNamespace,
        }),
      ]),
    );
    expect(config.routes).toEqual([{ pattern: "tagium.app", custom_domain: true }]);
  });

  it("rejects named environments and renamed workers", () => {
    expect(() => configureShareDeploymentBindings({ name: "tagium-preview" }, "preview")).toThrow(
      "Worker name",
    );
    expect(() => configureShareDeploymentBindings({ name: "tagium", env: {} }, "preview")).toThrow(
      "env arrays",
    );
  });
});
