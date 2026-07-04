import { describe, expect, it } from "vitest";
import {
  getSampleAlbum,
  getSampleTrack,
  sampleIndexFromSeed,
  sampleTracks,
} from "./sampleMetadata";

describe("sample metadata placeholders", () => {
  it("returns stable samples for the same seed", () => {
    expect(getSampleTrack("track-1")).toBe(getSampleTrack("track-1"));
    expect(getSampleAlbum("album-1")).toBe(getSampleAlbum("album-1"));
  });

  it("maps seeds into the sample list", () => {
    const index = sampleIndexFromSeed("track-1", sampleTracks.length);

    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(sampleTracks.length);
  });
});
