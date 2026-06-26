import { describe, expect, it } from "vite-plus/test";
import { mergeUploadedTracksIntoAlbums } from "./albumOps";
import type { UploadedTrack } from "./mp3Utils";
import type { AudioMetadata } from "./types";

const metadata = (trackNumber?: number): AudioMetadata => ({
  filename: "track",
  title: "Track",
  artist: "Artist",
  album: "Album",
  year: 2024,
  genre: "",
  duration: 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  trackNumber,
});

const upload = (
  id: string,
  albumSeed: UploadedTrack["albumSeed"],
  trackNumber?: number,
): UploadedTrack => ({
  file: {
    id,
    file: new File(["a"], `${id}.mp3`, { type: "audio/mpeg" }),
    originalFile: new File(["a"], `${id}.mp3`, { type: "audio/mpeg" }),
    filename: `${id}.mp3`,
    status: "pending",
    downloadStatus: "ready",
    hasBufferedChanges: false,
    metadata: metadata(trackNumber),
  },
  albumSeed,
});

describe("albumOps", () => {
  it("uses original import order as the forced album seed source", () => {
    const originalUploads = [
      upload("track-10", { title: "Tagged Album", artist: "Tagged Artist", genre: "Rock" }, 10),
      upload("track-1", { title: "", artist: "", genre: "" }, 1),
    ];
    const sortedUploads = [originalUploads[1], originalUploads[0]];

    const result = mergeUploadedTracksIntoAlbums([], sortedUploads, {
      forceSingleAlbum: true,
      albumSeedUploads: originalUploads,
    });

    expect(result.albums[0].title).toBe("Tagged Album");
    expect(result.albums[0].artist).toBe("Tagged Artist");
    expect(result.albums[0].genre).toBe("Rock");
    expect(result.albums[0].trackIds).toEqual(["track-1", "track-10"]);
    expect(result.albumsToSync).toEqual([result.albums[0].id]);
  });

  it("uses settings for uploaded album track-number defaults", () => {
    const result = mergeUploadedTracksIntoAlbums(
      [],
      [upload("track-1", { title: "Tagged Album", artist: "Tagged Artist", genre: "Rock" }, 1)],
      {
        settings: {
          syncTrackNumbers: false,
        },
      },
    );

    expect(result.albumsToSync).toEqual([]);
  });
});
