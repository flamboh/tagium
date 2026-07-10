import { describe, expect, it, vi } from "vite-plus/test";
import { getYouTubeVideoId, resolveYouTubeUploadYear } from "./youtube";

const youtubeConfig = {
  INNERTUBE_API_KEY: "api-key",
  INNERTUBE_CLIENT_VERSION: "2.20260708.00.00",
  INNERTUBE_CONTEXT: { client: { clientName: "WEB" } },
};

const nextResponse = (dateText: string) =>
  Response.json({
    contents: {
      twoColumnWatchNextResults: {
        results: {
          results: {
            contents: [{ videoPrimaryInfoRenderer: { dateText: { simpleText: dateText } } }],
          },
        },
      },
    },
  });

describe("youtube video metadata", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("extracts the video id from %s", (url, expectedVideoId) => {
    expect(getYouTubeVideoId(url)).toBe(expectedVideoId);
  });

  it("rejects playlists, non-YouTube URLs, and malformed video ids", () => {
    expect(getYouTubeVideoId("https://www.youtube.com/playlist?list=PL123")).toBeUndefined();
    expect(getYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeUndefined();
    expect(getYouTubeVideoId("https://www.youtube.com/watch?v=short")).toBeUndefined();
  });

  it("resolves the displayed upload year with discovered or supplied client config", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(`<script>ytcfg.set(${JSON.stringify(youtubeConfig)});</script>`),
      )
      .mockResolvedValueOnce(nextResponse("Apr 3, 2025"))
      .mockResolvedValueOnce(nextResponse("Apr 23, 2005"));

    await expect(resolveYouTubeUploadYear("https://youtu.be/dQw4w9WgXcQ", { fetch })).resolves.toBe(
      2025,
    );
    await expect(
      resolveYouTubeUploadYear("https://www.youtube.com/watch?v=jNQXAC9IVRw", {
        config: youtubeConfig,
        fetch,
      }),
    ).resolves.toBe(2005);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not fetch metadata for non-video URLs", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      resolveYouTubeUploadYear("https://soundcloud.com/artist/track", { fetch }),
    ).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
