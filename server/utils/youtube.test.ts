import { describe, expect, it, vi } from "vite-plus/test";
import { getYouTubeVideoId, resolveYouTubeUploadYear } from "./youtube";

const playerResponseHtml = (microformat: Record<string, unknown>) =>
  `<script>var ytInitialPlayerResponse = ${JSON.stringify({
    microformat: { playerMicroformatRenderer: microformat },
  })};</script>`;

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

  it("prefers the upload date year and falls back to publish date", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          playerResponseHtml({
            uploadDate: "2025-04-03T21:00:23-07:00",
            publishDate: "2024-12-31T00:00:00-08:00",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(playerResponseHtml({ publishDate: "2005-04-23T20:31:52-07:00" })),
      );

    await expect(resolveYouTubeUploadYear("https://youtu.be/dQw4w9WgXcQ", { fetch })).resolves.toBe(
      2025,
    );
    await expect(
      resolveYouTubeUploadYear("https://www.youtube.com/watch?v=jNQXAC9IVRw", { fetch }),
    ).resolves.toBe(2005);
  });

  it("does not fetch metadata for non-video URLs", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      resolveYouTubeUploadYear("https://soundcloud.com/artist/track", { fetch }),
    ).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
