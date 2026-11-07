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
      kind: "skipped",
      addedCount: 9,
      totalCount: 12,
      skippedCount: 3,
    });
  });

  it("explains a playlist cut short", () => {
    expect(playlistImportNotice(playlist(200, 0, true))).toEqual({
      kind: "truncated",
      addedCount: 200,
    });
  });
});
