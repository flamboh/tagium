import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createPlaylistDownloadPlan } from "@/features/import/downloadTrack";
import type { Playlist } from "@/features/import/playlist";
import { isYouTubePlaylistUrl, resolveYouTubePlaylist } from "@/features/import/youtubePlaylist";

const playlist: Playlist = {
  title: "Status Update Music",
  artist: "lucida",
  genre: "",
  year: 2026,
  isAlbum: false,
  coverUrl: "https://i.ytimg.com/playlist.jpg",
  tracks: [
    {
      title: "First Track",
      url: "https://www.youtube.com/watch?v=first-video",
      duration: 254,
      trackNumber: 1,
    },
    {
      title: "Second Track",
      url: "https://www.youtube.com/watch?v=second-video",
      duration: 229,
      trackNumber: 2,
    },
  ],
};

describe("YouTube playlist imports", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recognizes canonical YouTube and YouTube Music playlist links", () => {
    expect(
      isYouTubePlaylistUrl(
        "https://www.youtube.com/playlist?list=PLESiES1i-ThqUjxot6jWLDu90fxtkcpA0",
      ),
    ).toBe(true);
    expect(isYouTubePlaylistUrl("https://music.youtube.com/playlist?list=PL123")).toBe(true);
    expect(isYouTubePlaylistUrl("https://www.youtube.com/watch?v=video&list=PL123")).toBe(false);
    expect(isYouTubePlaylistUrl("https://example.com/playlist?list=PL123")).toBe(false);
  });

  it("creates an album group and queues each playlist video independently", () => {
    const ids = ["album-1", "track-1", "track-2"];
    const plan = createPlaylistDownloadPlan({
      playlist,
      audioBitrate: "320",
      createId: () => ids.shift()!,
    });

    expect(plan.source).toBe("playlist");
    expect(plan.album).toMatchObject({
      id: "album-1",
      title: "Status Update Music",
      artist: "lucida",
      year: 2026,
      trackIds: ["track-1", "track-2"],
    });
    expect(plan.queuedTracks.map((track) => track.downloadRequest.sourceUrl)).toEqual([
      "https://www.youtube.com/watch?v=first-video",
      "https://www.youtube.com/watch?v=second-video",
    ]);
    expect(plan.queuedTracks.map((track) => track.downloadRequest.year)).toEqual([2026, 2026]);
    expect(plan.pendingFiles.map((file) => file.pendingMetadataPatch?.trackNumber)).toEqual([1, 2]);
    expect(plan.coverImport?.playlist.isAlbum).toBe(false);
  });

  it("rejects malformed playlist responses", async () => {
    vi.stubGlobal("window", { location: { origin: "https://tagium.test" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...playlist,
          tracks: [{ title: "Broken", url: "not-a-url", trackNumber: 1 }],
        }),
      ),
    );

    await expect(
      resolveYouTubePlaylist("https://www.youtube.com/playlist?list=PL123"),
    ).rejects.toThrow();
  });
});
