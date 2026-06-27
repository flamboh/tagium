import { describe, expect, it } from "vite-plus/test";
import {
  allTracksReadyForDownload,
  createLibraryDownloadFilename,
  getLibraryDownloadEntries,
} from "./downloadLibrary";
import type { AlbumGroup, AudioMetadata, TagiumFile } from "./types";

const metadata = (filename: string): AudioMetadata => ({
  filename: filename.replace(/\.mp3$/i, ""),
  title: filename,
  artist: "",
  album: "",
  year: undefined,
  genre: "",
  duration: 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  trackNumber: undefined,
});

const file = (id: string, filename: string, contents = id): TagiumFile => ({
  id,
  filename,
  file: new File([contents], filename, { type: "audio/mpeg" }),
  originalFile: new File([contents], filename, { type: "audio/mpeg" }),
  status: "saved",
  downloadStatus: "ready",
  hasBufferedChanges: false,
  metadata: metadata(filename),
});

const missingFile = (id: string, filename: string): TagiumFile => ({
  id,
  filename,
  status: "pending",
  downloadStatus: "downloading",
  hasBufferedChanges: false,
});

const missingMetadata = (id: string, filename: string): TagiumFile => ({
  id,
  filename,
  file: new File([id], filename, { type: "audio/mpeg" }),
  originalFile: new File([id], filename, { type: "audio/mpeg" }),
  status: "error",
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

describe("downloadLibrary", () => {
  it("creates timestamped library download filenames", () => {
    expect(createLibraryDownloadFilename(new Date(2026, 0, 2, 3, 4, 5))).toBe(
      "tagium-download-20260102-030405.zip",
    );
  });

  it("builds album and singles entries in sidebar order", () => {
    const files = [
      file("loose-1", "single.mp3"),
      file("album-1", "first.mp3"),
      file("album-2", "second.mp3"),
    ];

    const entries = getLibraryDownloadEntries({
      albums: [album("album", "Album One", ["album-1", "album-2"])],
      looseTrackIds: ["loose-1"],
      files,
    });

    expect(entries.map((entry) => entry.path)).toEqual([
      "albums/Album One/first.mp3",
      "albums/Album One/second.mp3",
      "singles/single.mp3",
    ]);
  });

  it("can nest a single album export at the zip root", () => {
    const entries = getLibraryDownloadEntries({
      albums: [album("album", "Single Track Album", ["track"])],
      looseTrackIds: [],
      files: [file("track", "song.mp3")],
      albumRoot: "",
    });

    expect(entries.map((entry) => entry.path)).toEqual(["Single Track Album/song.mp3"]);
  });

  it("can scope a single album export without unrelated tracks", () => {
    const entries = getLibraryDownloadEntries({
      albums: [album("album", "Album", ["track"])],
      looseTrackIds: [],
      files: [file("track", "song.mp3"), file("other", "other.mp3")],
      albumRoot: "",
      includeUnassignedFiles: false,
    });

    expect(entries.map((entry) => entry.path)).toEqual(["Album/song.mp3"]);
  });

  it("does not reserve folder names for empty albums", () => {
    const entries = getLibraryDownloadEntries({
      albums: [album("empty", "Album", []), album("full", "Album", ["track"])],
      looseTrackIds: [],
      files: [file("track", "song.mp3")],
    });

    expect(entries.map((entry) => entry.path)).toEqual(["albums/Album/song.mp3"]);
  });

  it("detects and skips tracks that are not ready for download", () => {
    const files = [file("ready", "ready.mp3"), missingFile("missing", "missing.mp3")];

    const entries = getLibraryDownloadEntries({
      albums: [album("album", "Album", ["ready", "missing"])],
      looseTrackIds: [],
      files,
    });

    expect(allTracksReadyForDownload(files)).toBe(false);
    expect(entries.map((entry) => entry.path)).toEqual(["albums/Album/ready.mp3"]);
  });

  it("requires metadata before tracks are ready for download", () => {
    const unreadyFile = missingMetadata("missing", "missing.mp3");
    const entries = getLibraryDownloadEntries({
      albums: [album("album", "Album", ["missing"])],
      looseTrackIds: [],
      files: [unreadyFile],
    });

    expect(allTracksReadyForDownload([file("ready", "ready.mp3")])).toBe(true);
    expect(allTracksReadyForDownload([unreadyFile])).toBe(false);
    expect(entries).toEqual([]);
  });

  it("sanitizes and deduplicates zip paths", () => {
    const files = [
      file("a", "../track.mp3"),
      file("b", "../track.mp3"),
      file("c", "loose/name.mp3"),
    ];

    const entries = getLibraryDownloadEntries({
      albums: [album("one", "../Album", ["a"]), album("two", "../Album", ["b"])],
      looseTrackIds: ["c"],
      files,
    });

    expect(entries.map((entry) => entry.path)).toEqual([
      "albums/-Album/-track.mp3",
      "albums/-Album-2/-track.mp3",
      "singles/loose-name.mp3",
    ]);
  });
});
