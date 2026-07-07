import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeAudioDevFault,
  enforceRateLimit,
  getDeployEnv,
  getDevControlSnapshot,
  resetRateLimitBuckets,
  setDevFault,
  updateDevConfig,
} from "./dev-controls";

const request = (url = "https://tagium.app/api/cobalt/audio") => new Request(url);

describe("dev controls", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    updateDevConfig({
      rateLimit: { windowMs: 60_000, maxRequests: 60 },
    });
    setDevFault({ target: "audio", fault: null });
    setDevFault({ target: "tunnel", fault: null });
  });

  it("enables dev controls on localhost", () => {
    expect(getDeployEnv(request("http://localhost:5173/api/dev/config"), {}).deployEnv).toBe(
      "local",
    );
  });

  it("detects Cloudflare Pages preview branches", () => {
    expect(
      getDeployEnv(request(), {
        CF_PAGES: "1",
        CF_PAGES_BRANCH: "codex/dev-panel",
        TAGIUM_PRODUCTION_BRANCH: "main",
      }).deployEnv,
    ).toBe("preview");
  });

  it("keeps Cloudflare Pages production branch disabled", () => {
    expect(
      getDeployEnv(request(), {
        CF_PAGES: "1",
        CF_PAGES_BRANCH: "main",
      }).deployEnv,
    ).toBe("production");
  });

  it("adjusts rate limits at runtime", () => {
    updateDevConfig({
      rateLimit: { windowMs: 60_000, maxRequests: 1 },
    });

    expect(enforceRateLimit(request())).toBeUndefined();
    expect(enforceRateLimit(request())?.status).toBe(429);
  });

  it("reports current rate limit bucket state", () => {
    updateDevConfig({
      rateLimit: { windowMs: 60_000, maxRequests: 2 },
    });
    enforceRateLimit(request());

    const snapshot = getDevControlSnapshot(request("http://localhost:5173/api/dev/config"), {});

    expect(snapshot.rateLimit.client.count).toBe(1);
    expect(snapshot.rateLimit.client.remaining).toBe(1);
  });

  it("consumes preview audio faults once", () => {
    const runtimeEnv = { TAGIUM_DEPLOY_ENV: "preview" };
    setDevFault({ target: "audio", fault: "rate-limit" });

    expect(consumeAudioDevFault(request(), runtimeEnv)).toBe("rate-limit");
    expect(consumeAudioDevFault(request(), runtimeEnv)).toBeUndefined();
  });

  it("does not consume audio faults in production", () => {
    setDevFault({ target: "audio", fault: "rate-limit" });

    expect(consumeAudioDevFault(request(), { TAGIUM_DEPLOY_ENV: "production" })).toBeUndefined();
  });
});
