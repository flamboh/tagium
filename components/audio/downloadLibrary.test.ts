import { describe, expect, it, vi } from "vite-plus/test";
import {
  allTracksReadyForDownload,
  createLibraryDownloadFilename,
  createZipBlob,
  getLibraryDownloadEntries,
  isTrackReadyForDownload,
} from "./downloadLibrary";
import type { AlbumGroup, AudioMetadata, TagiumFile } from "./types";

const metadata = (filename: string): AudioMetadata => ({
  filename: filename.replace(/\.mp3$/i, ""),
  title: filename,
  artist: "",
  album: "",
  year: null,
  genre: "",
  duration: 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  trackNumber: null,
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

const cover: AudioMetadata["picture"] = [
  {
    format: "image/jpeg",
    type: 3,
    description: "album cover",
    data: new Uint8Array([1, 2, 3]),
  },
];

describe("downloadLibrary", () => {
  it("streams file data into exports without whole-file arrayBuffer reads", async () => {
    const track = new File(["streamed audio"], "track.mp3", { type: "audio/mpeg" });
    const arrayBuffer = vi
      .spyOn(track, "arrayBuffer")
      .mockRejectedValue(new Error("whole-file read is not allowed"));

    const archive = await createZipBlob([{ path: "track.mp3", file: track }]);
    const { unzipSync } = await import("fflate");
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));

    expect(new TextDecoder().decode(files["track.mp3"])).toBe("streamed audio");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

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
    const singleAlbum = {
      ...album("album", "Single Track Album", ["track"]),
      cover,
    };
    const entries = getLibraryDownloadEntries({
      albums: [singleAlbum],
      looseTrackIds: [],
      files: [file("track", "song.mp3")],
      albumRoot: "",
    });

    expect(entries.map((entry) => entry.path)).toEqual([
      "Single Track Album/song.mp3",
      "Single Track Album/cover.jpg",
    ]);
    expect(entries[1]?.file.type).toBe("image/jpeg");
  });

  it("bundles png album cover files with album folders", () => {
    const pngCover: AudioMetadata["picture"] = [
      {
        format: "image/png",
        type: 3,
        description: "album cover",
        data: new Uint8Array([4, 5, 6]),
      },
    ];
    const entries = getLibraryDownloadEntries({
      albums: [{ ...album("album", "Album One", ["track"]), cover: pngCover }],
      looseTrackIds: [],
      files: [file("track", "song.mp3")],
    });

    expect(entries.map((entry) => entry.path)).toEqual([
      "albums/Album One/song.mp3",
      "albums/Album One/cover.png",
    ]);
    expect(entries[1]?.file.type).toBe("image/png");
  });

  it("preserves cover-like track filenames when adding album cover files", () => {
    const entries = getLibraryDownloadEntries({
      albums: [{ ...album("album", "Album", ["track"]), cover }],
      looseTrackIds: [],
      files: [file("track", "cover.jpg")],
    });

    expect(entries.map((entry) => entry.path)).toEqual([
      "albums/Album/cover.jpg",
      "albums/Album/cover-2.jpg",
    ]);
  });

  it("uses cover file extensions for image content types with parameters", () => {
    const parameterizedCover: AudioMetadata["picture"] = [
      {
        format: "image/jpeg; charset=utf-8",
        type: 3,
        description: "album cover",
        data: new Uint8Array([7, 8, 9]),
      },
    ];
    const entries = getLibraryDownloadEntries({
      albums: [{ ...album("album", "Album", ["track"]), cover: parameterizedCover }],
      looseTrackIds: [],
      files: [file("track", "song.mp3")],
    });

    expect(entries.map((entry) => entry.path)).toEqual([
      "albums/Album/song.mp3",
      "albums/Album/cover.jpg",
    ]);
    expect(entries[1]?.file.type).toBe("image/jpeg");
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

  it("blocks every export containing a track with an empty filename", () => {
    const invalidFilename = file("invalid", "original.mp3");
    invalidFilename.metadata = metadata("");

    const entries = getLibraryDownloadEntries({
      albums: [album("album", "Album", ["invalid"])],
      looseTrackIds: [],
      files: [invalidFilename],
    });

    expect(isTrackReadyForDownload(invalidFilename)).toBe(false);
    expect(allTracksReadyForDownload([invalidFilename])).toBe(false);
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
