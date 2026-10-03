import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Playlist } from "@/features/import/playlist";
import { resolveYouTubePlaylist } from "@/features/import/youtubePlaylist";

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
