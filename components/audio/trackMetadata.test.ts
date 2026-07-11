import { describe, expect, it } from "vitest";
import { decodeTrackMetadata } from "./trackMetadata";

describe("track metadata", () => {
  it("decodes provider metadata used before download", async () => {
    await expect(
      decodeTrackMetadata({
        title: "Archangel",
        artist: "Burial",
        coverUrl: "https://example.com/cover.jpg",
      }),
    ).resolves.toEqual({
      title: "Archangel",
      artist: "Burial",
      coverUrl: "https://example.com/cover.jpg",
    });
  });

  it("rejects malformed provider metadata", async () => {
    await expect(decodeTrackMetadata({ title: 42, artist: "Burial" })).rejects.toThrow(
      "malformed track metadata response",
    );
  });
});
