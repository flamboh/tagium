import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { resolveYouTubePlaylist } from "../../../server/utils/youtube-playlist";

const playlistUrl = "https://www.youtube.com/playlist?list=PLabc123";

const playlistHtml = (initialData: unknown) =>
  `<html><script>var ytInitialData = ${JSON.stringify(initialData)};</script></html>`;

const stubYouTube = (initialData: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(playlistHtml(initialData))),
  );

describe("youtube playlist resolution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers 422 when a fully read playlist has no tracks", async () => {
    stubYouTube({ metadata: { playlistMetadataRenderer: { title: "empty" } } });

    const error = await resolveYouTubePlaylist(playlistUrl, new AbortController().signal).catch(
      (cause: unknown) => cause,
    );

    expect(error).toMatchObject({ status: 422, message: "youtube.no_resolvable_tracks" });
  });

  it("stays retryable when pagination stops before any tracks were read", async () => {
    stubYouTube({
      metadata: { playlistMetadataRenderer: { title: "paged" } },
      contents: [{ continuationCommand: { token: "next-page" } }],
    });

    const error = await resolveYouTubePlaylist(playlistUrl, new AbortController().signal).catch(
      (cause: unknown) => cause,
    );

    expect(error).toMatchObject({ status: 502, message: "youtube.no_resolvable_tracks" });
  });
});
