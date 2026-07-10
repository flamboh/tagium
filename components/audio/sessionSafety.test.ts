import { describe, expect, it } from "vite-plus/test";
import { hasRecoverableSessionWork } from "./sessionSafety";

describe("session safety", () => {
  it("protects sessions that contain tracks, albums, or in-progress imports", () => {
    expect(hasRecoverableSessionWork({ fileCount: 0, albumCount: 0, importing: false })).toBe(
      false,
    );
    expect(hasRecoverableSessionWork({ fileCount: 1, albumCount: 0, importing: false })).toBe(true);
    expect(hasRecoverableSessionWork({ fileCount: 0, albumCount: 1, importing: false })).toBe(true);
    expect(hasRecoverableSessionWork({ fileCount: 0, albumCount: 0, importing: true })).toBe(true);
  });
});
