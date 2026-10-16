import { describe, expect, it } from "vite-plus/test";
import { playlistImportNotice, type PlaylistResponse } from "@/features/import/playlist";

const playlist = (
  trackCount: number,
  skippedCount: number,
  truncated = false,
): PlaylistResponse => ({
  title: "Mixed",
  artist: "Artist",
  genre: "",
  isAlbum: false,
  tracks: Array.from({ length: trackCount }, (_, index) => ({
    title: `Track ${index + 1}`,
    url: `https://soundcloud.com/artist/track-${index + 1}`,
    trackNumber: index + 1,
  })),
  skippedCount,
  truncated,
});

describe("playlist import notice", () => {
  it("stays quiet when every track was added", () => {
    expect(playlistImportNotice(playlist(12, 0))).toBeNull();
  });

  it("explains skipped tracks", () => {
    expect(playlistImportNotice(playlist(9, 3))).toEqual({
      title: "added 9 of 12 tracks",
      description: "3 were private or unavailable.",
    });
    expect(playlistImportNotice(playlist(11, 1))?.description).toBe(
      "1 was private or unavailable.",
    );
  });

  it("explains a playlist cut short", () => {
    expect(playlistImportNotice(playlist(200, 0, true))).toEqual({
      title: "added the first 200 tracks of this playlist",
    });
  });
});
