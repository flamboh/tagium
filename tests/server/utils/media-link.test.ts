import { describe, expect, it } from "vitest";
import { mediaLinkKindFromUrl, parseMediaLink } from "../../../src/lib/media-link";
import { resolveSoundCloudShortLink } from "../../../server/utils/soundcloud-link";

describe("media link contract", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "canonical"],
    ["https://youtu.be/dQw4w9WgXcQ", "short"],
    ["https://m.soundcloud.com/a/t", "mobile"],
    ["https://youtube-nocookie.com/embed/dQw4w9WgXcQ", "nocookie"],
    ["https://example.com/media", "other"],
  ] as const)("classifies %s as %s", (input, kind) => {
    expect(mediaLinkKindFromUrl(input)).toBe(kind);
  });

  it.each([
    ["https://youtu.be/qEIbFhBzfvA", "https://www.youtube.com/watch?v=qEIbFhBzfvA", "track"],
    ["https://youtu.be/dQw4w9WgXcQ?si=x", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "track"],
    [
      "https://m.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "track",
    ],
    [
      "https://www.youtube.com/embed/videoseries?list=PL123",
      "https://www.youtube.com/playlist?list=PL123",
      "playlist",
    ],
    [
      "https://www.youtube-nocookie.com/embed?listType=playlist&list=PL123",
      "https://www.youtube.com/playlist?list=PL123",
      "playlist",
    ],
    [
      "https://youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "track",
    ],
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=2",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "track",
    ],
    [
      "https://m.soundcloud.com/a/t?secret_token=s-abc&utm_source=x",
      "https://soundcloud.com/a/t/s-abc",
      "track",
    ],
    [
      "https://www.soundcloud.com/a/sets/mix?secret_token=s-xyz&utm_medium=x",
      "https://soundcloud.com/a/sets/mix/s-xyz",
      "playlist",
    ],
  ])("normalizes %s", (input, canonical, kind) => {
    const result = parseMediaLink(input);
    expect(result.canonicalUrl).toBe(canonical);
    expect(result.kind).toBe(kind);
  });

  it.each([
    "https://foo.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.example/watch?v=dQw4w9WgXcQ",
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://soundcloud.com.evil/a/t",
  ])("rejects %s", (input) => {
    expect(parseMediaLink(input).kind).toBe("unsupported");
  });
  it.each(["https://soundcloud.com/a/t/extra", "https://soundcloud.com/a/sets/mix/extra"])(
    "rejects malformed SoundCloud path %s",
    (input) => expect(parseMediaLink(input).kind).toBe("unsupported"),
  );
});

describe("bounded SoundCloud short links", () => {
  const response = (status: number, location?: string) =>
    new Response(null, { status, headers: location ? { location } : undefined });
  it("resolves a relative redirect to a track", async () => {
    let first = true;
    const result = await resolveSoundCloudShortLink("https://on.soundcloud.com/x", {
      fetch: async () =>
        first
          ? ((first = false), response(302, "https://soundcloud.com/artist/track"))
          : response(200),
    });
    expect(result.kind).toBe("track");
  });
  it("upgrades legacy snd.sc before fetching", async () => {
    let seen = "";
    await expect(
      resolveSoundCloudShortLink("http://snd.sc/x", {
        fetch: async (url) => {
          seen = url instanceof URL ? url.href : url instanceof Request ? url.url : url;
          return response(200);
        },
      }),
    ).rejects.toThrow();
    expect(seen.startsWith("https://snd.sc/")).toBe(true);
  });
  it("rejects off-provider destinations and excessive hops", async () => {
    await expect(
      resolveSoundCloudShortLink("https://on.soundcloud.com/x", {
        fetch: async () => response(302, "https://example.com"),
      }),
    ).rejects.toThrow("off_provider");
    let count = 0;
    await expect(
      resolveSoundCloudShortLink("https://on.soundcloud.com/x", {
        fetch: async () => {
          count++;
          return response(302, `https://on.soundcloud.com/${count}`);
        },
      }),
    ).rejects.toThrow("too_many_redirects");
  });
});
