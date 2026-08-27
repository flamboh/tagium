import { describe, expect, it } from "vite-plus/test";
import { getAppTitle, resolveApp } from "@/runtime/resolveApp";

describe("app resolution", () => {
  it("selects tagium save on its production hostname", () => {
    expect(resolveApp({ hostname: "SAVE.TAGIUM.APP", search: "" })).toBe("tagium-save");
  });

  it("selects tagium save explicitly in previews and local development", () => {
    expect(resolveApp({ hostname: "localhost", search: "?app=tagium-save" })).toBe("tagium-save");
    expect(resolveApp({ hostname: "preview.workers.dev", search: "?app=tagium-save" })).toBe(
      "tagium-save",
    );
  });

  it("defaults to tagium and removes obsolete video routes", () => {
    expect(resolveApp({ hostname: "tagium.app", search: "" })).toBe("tagium");
    expect(resolveApp({ hostname: "tagium.app", search: "?app=tagium-save" })).toBe("tagium");
    expect(resolveApp({ hostname: "video.tagium.app", search: "" })).toBe("tagium");
    expect(resolveApp({ hostname: "localhost", search: "?video=1" })).toBe("tagium");
  });

  it("provides the matching document title", () => {
    expect(getAppTitle("tagium")).toBe("tagium");
    expect(getAppTitle("tagium-save")).toBe("tagium save");
  });
});
