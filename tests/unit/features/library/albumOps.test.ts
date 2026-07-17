import { describe, expect, it } from "vite-plus/test";
import {
  mergeUploadedTracksIntoAlbums,
  moveTrackInSidebar,
  reorderAlbums,
} from "@/features/library/albumOps";
import type { UploadedTrack } from "@/features/audio/mp3Utils";
import type { AlbumGroup, AudioMetadata } from "@/features/library/types";

const metadata = (trackNumber?: number): AudioMetadata => ({
  filename: "track",
  title: "Track",
  artist: "Artist",
  albumArtist: "Artist",
  album: "Album",
  year: 2024,
  genre: "",
  duration: 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  trackNumber: trackNumber ?? null,
  discNumber: null,
  composer: "",
  bpm: null,
  comment: "",
});

const upload = (
  id: string,
  albumSeed: UploadedTrack["albumSeed"],
  trackNumber?: number,
): UploadedTrack => ({
  file: {
    id,
    format: "mp3",
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

const album = (id: string, trackIds: string[]): AlbumGroup => ({
  id,
  title: id,
  artist: "",
  genre: "",
  trackIds,
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

  it("keeps a single upload with album metadata loose", () => {
    const result = mergeUploadedTracksIntoAlbums(
      [],
      [upload("track-1", { title: "Tagged Album", artist: "Tagged Artist", genre: "Rock" })],
    );

    expect(result.albums).toEqual([]);
    expect(result.firstSelectedAlbumId).toBeNull();
    expect(result.unassignedTrackIds).toEqual(["track-1"]);
    expect(result.albumsToSync).toEqual([]);
  });

  it("groups only matching album metadata from a multi-track upload", () => {
    const result = mergeUploadedTracksIntoAlbums(
      [],
      [
        upload("track-1", { title: "Tagged Album", artist: "Tagged Artist", genre: "Rock" }),
        upload("track-2", { title: "Tagged Album", artist: "Tagged Artist", genre: "Rock" }),
        upload("track-3", { title: "Single Metadata", artist: "Tagged Artist", genre: "Rock" }),
      ],
    );

    expect(result.albums).toHaveLength(1);
    expect(result.albums[0].trackIds).toEqual(["track-1", "track-2"]);
    expect(result.unassignedTrackIds).toEqual(["track-3"]);
  });

  it("moves tracks between album and loose sidebar lists", () => {
    const result = moveTrackInSidebar(
      [album("album-1", ["a", "b"]), album("album-2", ["c"])],
      ["loose-1"],
      "b",
      {
        type: "album",
        albumId: "album-2",
        placement: "before",
        referenceTrackId: "c",
      },
      { syncTrackNumbers: true },
    );

    expect(result.albums.map((entry) => entry.trackIds)).toEqual([["a"], ["b", "c"]]);
    expect(result.looseTrackIds).toEqual(["loose-1"]);
    expect(result.albumsToSync).toEqual(["album-1", "album-2"]);
  });

  it("keeps track moves single-track and preserves empty albums", () => {
    const result = moveTrackInSidebar(
      [album("album-1", ["a"])],
      ["loose-1", "loose-2"],
      "a",
      {
        type: "loose",
        placement: "after",
        referenceTrackId: "loose-1",
      },
      { syncTrackNumbers: false },
    );

    expect(result.albums).toEqual([album("album-1", [])]);
    expect(result.looseTrackIds).toEqual(["loose-1", "a", "loose-2"]);
    expect(result.albumsToSync).toEqual([]);
  });

  it("reorders albums by target index", () => {
    const albums = [album("album-1", []), album("album-2", []), album("album-3", [])];

    expect(reorderAlbums(albums, "album-1", 2).map((entry) => entry.id)).toEqual([
      "album-2",
      "album-3",
      "album-1",
    ]);
    expect(reorderAlbums(albums, "missing", 1)).toEqual(albums);
  });
});
