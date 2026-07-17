import { describe, expect, it } from "vitest";
import {
  getTrackMetadataEndpoint,
  normalizeTrackMetadataArtist,
  resolveSoundCloudTrackMetadata,
} from "../../server/api/track-metadata.get";

describe("track metadata provider routing", () => {
  it("routes only YouTube tracks through oEmbed", () => {
    expect(getTrackMetadataEndpoint("https://youtu.be/abcdefghijk")?.origin).toBe(
      "https://www.youtube.com",
    );
    expect(getTrackMetadataEndpoint("https://soundcloud.com/burial/archangel")).toBeUndefined();
  });

  it("does not fetch metadata for unsupported providers", () => {
    expect(getTrackMetadataEndpoint("https://example.com/audio")).toBeUndefined();
  });

  it("normalizes YouTube Topic artists to match hydrated Cobalt metadata", () => {
    expect(
      normalizeTrackMetadataArtist("Burial - Topic", new URL("https://www.youtube.com/oembed")),
    ).toBe("Burial");
    expect(
      normalizeTrackMetadataArtist("Burial - Topic", new URL("https://soundcloud.com/oembed")),
    ).toBe("Burial - Topic");
  });

  it("uses SoundCloud's canonical track title instead of its oEmbed display title", async () => {
    const metadata = await resolveSoundCloudTrackMetadata(
      "https://soundcloud.com/youngkimj/get-up-get-down-everybodyyy",
      {
        getClientId: async () => "client-id",
        fetch: async () =>
          new Response(
            JSON.stringify({
              title: "Get Up Get Down Everybodyyy",
              user: { username: "kimj" },
              artwork_url: null,
            }),
          ),
      },
    );

    expect(metadata).toEqual({
      title: "Get Up Get Down Everybodyyy",
      artist: "kimj",
      coverUrl: undefined,
    });
  });
});
