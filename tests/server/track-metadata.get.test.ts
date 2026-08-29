import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { mockEvent } from "h3";
import handler, {
  getTrackMetadataEndpoint,
  normalizeTrackMetadataArtist,
  resolveSoundCloudTrackMetadata,
} from "../../server/api/track-metadata.get";

const makeEvent = (sourceUrl: string) =>
  mockEvent(
    new Request(`https://tagium.test/api/track-metadata?url=${encodeURIComponent(sourceUrl)}`),
  );

describe("track metadata provider routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("resolves SoundCloud share links before fetching track metadata", async () => {
    const shortUrl = "https://on.soundcloud.com/share-token";
    const canonicalUrl = "https://soundcloud.com/artist/covered-track";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : new URL(input).toString();

        if (url === shortUrl) {
          return new Response(null, {
            status: 302,
            headers: { location: canonicalUrl },
          });
        }
        if (url === canonicalUrl) return new Response(null);
        if (url === "https://soundcloud.com/") {
          return new Response('{"hydratable":"apiClient","data":{"id":"client-id"}}');
        }
        if (url.startsWith("https://api-v2.soundcloud.com/resolve")) {
          expect(new URL(url).searchParams.get("url")).toBe(canonicalUrl);
          return Response.json({
            title: "Covered Track",
            artwork_url: "https://i1.sndcdn.com/artworks-large.jpg",
            user: { username: "Artist" },
          });
        }

        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    await expect(handler(makeEvent(shortUrl))).resolves.toEqual({
      title: "Covered Track",
      artist: "Artist",
      coverUrl: "https://i1.sndcdn.com/artworks-t1080x1080.jpg",
    });
  });
});
