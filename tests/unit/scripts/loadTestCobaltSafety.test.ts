import { describe, expect, it } from "vitest";
import {
  assertTunnelMatchesLoadTestTarget,
  parseLoadTestTarget,
} from "../../../scripts/load-test-cobalt-safety";

describe("Cobalt load-test safety", () => {
  it("accepts an HTTPS disposable origin", () => {
    expect(parseLoadTestTarget("https://tagium-cobalt-loadtest.fly.dev").origin).toBe(
      "https://tagium-cobalt-loadtest.fly.dev",
    );
  });

  it("refuses the production Cobalt origin", () => {
    expect(() => parseLoadTestTarget("https://tagium-cobalt.fly.dev")).toThrow(
      "Refusing to load-test production Cobalt",
    );
  });

  it.each([
    "http://tagium-cobalt-loadtest.fly.dev",
    "https://user:password@tagium-cobalt-loadtest.fly.dev",
    "https://tagium-cobalt-loadtest.fly.dev/tunnel",
    "https://tagium-cobalt-loadtest.fly.dev/?target=production",
  ])("refuses unsafe target %s", (target) => {
    expect(() => parseLoadTestTarget(target)).toThrow();
  });

  it("accepts tunnels from the disposable origin", () => {
    const target = parseLoadTestTarget("https://tagium-cobalt-loadtest.fly.dev");

    expect(
      assertTunnelMatchesLoadTestTarget(
        target,
        "https://tagium-cobalt-loadtest.fly.dev/tunnel?id=safe",
      ),
    ).toBe("https://tagium-cobalt-loadtest.fly.dev/tunnel?id=safe");
  });

  it("aborts before a cross-origin tunnel can be fetched", () => {
    const target = parseLoadTestTarget("https://tagium-cobalt-loadtest.fly.dev");

    expect(() =>
      assertTunnelMatchesLoadTestTarget(
        target,
        "https://tagium-cobalt.fly.dev/tunnel?id=production",
      ),
    ).toThrow("aborting before the tunnel is fetched");
  });
});
