import { describe, expect, it } from "vite-plus/test";
import { applySoundCloudSetImportedCover } from "./fileMetadataOps";
import type { AlbumGroup, AudioMetadata, TagiumFile } from "./types";

const cover: AudioMetadata["picture"] = [
  {
    format: "image/jpeg",
    type: 3,
    description: "soundcloud cover",
    data: new Uint8Array([1, 2, 3]),
  },
];

const metadata = (): AudioMetadata => ({
  filename: "track",
  title: "Track",
  artist: "Artist",
  album: "Set",
  year: 2024,
  genre: "",
  duration: 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  trackNumber: undefined,
});

const readyFile = (id: string): TagiumFile => ({
  id,
  file: new File(["a"], `${id}.mp3`, { type: "audio/mpeg" }),
  originalFile: new File(["a"], `${id}.mp3`, { type: "audio/mpeg" }),
  filename: `${id}.mp3`,
  status: "saved",
  downloadStatus: "ready",
  hasBufferedChanges: false,
  metadata: metadata(),
});

const album = (trackIds: string[]): AlbumGroup => ({
  id: "album-1",
  title: "Set",
  artist: "Artist",
  genre: "",
  trackIds,
});

describe("soundcloud set cover writes", () => {
  it("applies SoundCloud album cover to album tracks when enabled", () => {
    const files = [readyFile("track-1"), readyFile("track-2"), readyFile("loose")];

    const result = applySoundCloudSetImportedCover(
      files,
      [album(["track-1", "track-2"])],
      "album-1",
      ["track-1", "track-2"],
      { isAlbum: true },
      { applySoundCloudAlbumCoverToTracks: true },
      cover,
      null,
    );

    expect(result.albums[0].cover).toEqual(cover);
    expect(result.files[0].metadata?.picture).toEqual(cover);
    expect(result.files[0].hasBufferedChanges).toBe(true);
    expect(result.files[1].metadata?.picture).toEqual(cover);
    expect(result.files[2]).toBe(files[2]);
  });

  it("keeps SoundCloud playlist cover off tracks regardless of setting", () => {
    const files = [readyFile("track-1")];

    for (const applySoundCloudAlbumCoverToTracks of [true, false]) {
      const result = applySoundCloudSetImportedCover(
        files,
        [album(["track-1"])],
        "album-1",
        ["track-1"],
        { isAlbum: false },
        { applySoundCloudAlbumCoverToTracks },
        cover,
        null,
      );

      expect(result.albums[0].cover).toEqual(cover);
      expect(result.files[0]).toBe(files[0]);
    }
  });
});
