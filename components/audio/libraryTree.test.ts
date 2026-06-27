import { describe, expect, it } from "vite-plus/test";
import { buildLibraryTree } from "./libraryTree";
import type { AlbumGroup, TagiumFile } from "./types";

const file = (id: string, filename: string): TagiumFile => ({
  id,
  filename,
  status: "pending",
  downloadStatus: "ready",
  hasBufferedChanges: false,
});

const album = (id: string, title: string, trackIds: string[]): AlbumGroup => ({
  id,
  title,
  artist: "",
  genre: "",
  trackIds,
});

describe("libraryTree", () => {
  it("builds readable tree paths with stable id lookups", () => {
    const tree = buildLibraryTree({
      albums: [album("album-1", "Album/One", ["track-1", "track-2"])],
      files: [file("track-1", "first.mp3"), file("track-2", "second.mp3")],
      looseTrackIds: [],
    });

    expect(tree.paths).toEqual(["Album:One/", "Album:One/1. first.mp3", "Album:One/2. second.mp3"]);
    expect(tree.pathByAlbumId.get("album-1")).toBe("Album:One/");
    expect(tree.pathByTrackId.get("track-2")).toBe("Album:One/2. second.mp3");
    expect(tree.entriesByPath.get("Album:One/2. second.mp3")).toMatchObject({
      albumId: "album-1",
      trackId: "track-2",
      type: "track",
    });
  });

  it("deduplicates visible path segments only where needed", () => {
    const tree = buildLibraryTree({
      albums: [album("album-1", "Same", ["track-1", "track-2"]), album("album-2", "Same", [])],
      files: [file("track-1", "song.mp3"), file("track-2", "song.mp3")],
      looseTrackIds: [],
    });

    expect(tree.paths).toEqual(["Same/", "Same/1. song.mp3", "Same/2. song.mp3", "Same (2)/"]);
  });

  it("keeps loose tracks at the root", () => {
    const tree = buildLibraryTree({
      albums: [album("album-1", "loose tracks", [])],
      files: [file("track-1", "loose.mp3")],
      looseTrackIds: ["track-1"],
    });

    expect(tree.paths).toEqual(["loose tracks/", "loose.mp3"]);
    expect(tree.entriesByPath.get("loose.mp3")).toMatchObject({
      albumId: null,
      trackId: "track-1",
      type: "track",
    });
    expect(tree.pathByAlbumId.get("album-1")).toBe("loose tracks/");
  });

  it("does not add a loose placeholder when albums exist", () => {
    const tree = buildLibraryTree({
      albums: [album("album-1", "album", ["track-1"])],
      files: [file("track-1", "track.mp3")],
      looseTrackIds: [],
    });

    expect(tree.paths).toEqual(["album/", "album/1. track.mp3"]);
  });

  it("keeps album folders stable before root loose tracks", () => {
    const tree = buildLibraryTree({
      albums: [album("album-1", "album", ["track-1"])],
      files: [file("track-1", "track.mp3"), file("loose-1", "loose.mp3")],
      looseTrackIds: ["loose-1"],
    });

    expect(tree.paths).toEqual(["album/", "album/1. track.mp3", "loose.mp3"]);
  });
});
