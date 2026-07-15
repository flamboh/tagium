import { describe, expect, it } from "vitest";
import { getCanonicalRedirectUrl } from "./canonical-origin";

describe("getCanonicalRedirectUrl", () => {
  it("redirects the previous domain while preserving the path and query", () => {
    expect(getCanonicalRedirectUrl("https://tagium.oli.boo/album/edit?track=2")).toBe(
      "https://tagium.app/album/edit?track=2",
    );
  });

  it("redirects the www hostname to the apex domain", () => {
    expect(getCanonicalRedirectUrl("https://www.tagium.app/settings")).toBe(
      "https://tagium.app/settings",
    );
  });

  it.each(["https://tagium.app/", "https://tagium-preview.workers.dev/"])(
    "does not redirect %s",
    (url) => {
      expect(getCanonicalRedirectUrl(url)).toBeUndefined();
    },
  );
});
