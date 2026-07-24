import { describe, expect, it } from "vite-plus/test";
import {
  parseTrackTagNumber,
  sortTrackIdsByTrackNumber,
  sortUploadedTracksByTrackNumber,
  type UploadedTrack,
} from "@/features/audio/mp3Utils";
import type { AudioMetadata } from "@/features/library/types";

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
  composer: "",
  comment: "",
  discNumber: null,
  bpm: null,
});

const upload = (id: string, trackNumber?: number): UploadedTrack => ({
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
  albumSeed: {
    title: "Album",
    artist: "Artist",
    genre: "",
  },
});

const failedUpload = (id: string): UploadedTrack => ({
  file: {
    id,
    file: new File(["a"], `${id}.mp3`, { type: "audio/mpeg" }),
    originalFile: new File(["a"], `${id}.mp3`, { type: "audio/mpeg" }),
    filename: `${id}.mp3`,
    status: "error",
    downloadStatus: "ready",
    downloadError: "Invalid ID3 tag",
    hasBufferedChanges: false,
  },
  albumSeed: {
    title: "",
    artist: "",
    genre: "",
  },
});

describe("mp3Utils", () => {
  it("parses only valid positive integer track tags", () => {
    expect(parseTrackTagNumber(undefined)).toBeUndefined();
    expect(parseTrackTagNumber("")).toBeUndefined();
    expect(parseTrackTagNumber("1")).toBe(1);
    expect(parseTrackTagNumber(" 2 ")).toBe(2);
    expect(parseTrackTagNumber("03/12")).toBe(3);
    expect(parseTrackTagNumber("0")).toBeUndefined();
    expect(parseTrackTagNumber("-1")).toBeUndefined();
    expect(parseTrackTagNumber("1.5")).toBeUndefined();
    expect(parseTrackTagNumber("1abc")).toBeUndefined();
    expect(parseTrackTagNumber("abc1")).toBeUndefined();
    expect(parseTrackTagNumber("/12")).toBeUndefined();
    expect(parseTrackTagNumber("Infinity")).toBeUndefined();
  });

  it("sorts uploaded tracks by valid track number with invalid tracks at the end", () => {
    const uploads = [
      upload("missing-track"),
      upload("track-3", 3),
      upload("track-1", 1),
      upload("zero-track", 0),
      upload("track-2", 2),
      failedUpload("parse-failure"),
    ];

    const result = sortUploadedTracksByTrackNumber(uploads);

    expect(result.map((entry) => entry.file.id)).toEqual([
      "track-1",
      "track-2",
      "track-3",
      "missing-track",
      "zero-track",
      "parse-failure",
    ]);
  });

  it("keeps stable order for duplicate and invalid uploaded track numbers", () => {
    const uploads = [
      upload("track-2-a", 2),
      upload("negative-track", -1),
      upload("track-2-b", 2),
      upload("missing-track"),
      upload("track-1", 1),
    ];

    const result = sortUploadedTracksByTrackNumber(uploads);

    expect(result.map((entry) => entry.file.id)).toEqual([
      "track-1",
      "track-2-a",
      "track-2-b",
      "negative-track",
      "missing-track",
    ]);
  });

  it("does not mutate parsed uploads", () => {
    const uploads = [upload("track-2", 2), upload("track-1", 1)];

    sortUploadedTracksByTrackNumber(uploads);

    expect(uploads.map((entry) => entry.file.id)).toEqual(["track-2", "track-1"]);
  });

  it("sorts existing album track ids by file track number", () => {
    const files = [
      upload("existing-track-9", 9).file,
      upload("imported-track-1", 1).file,
      upload("invalid-track", 0).file,
      failedUpload("parse-failure").file,
      upload("imported-track-2", 2).file,
    ];

    const result = sortTrackIdsByTrackNumber(
      [
        "existing-track-9",
        "invalid-track",
        "parse-failure",
        "imported-track-1",
        "imported-track-2",
      ],
      files,
    );

    expect(result).toEqual([
      "imported-track-1",
      "imported-track-2",
      "existing-track-9",
      "invalid-track",
      "parse-failure",
    ]);
  });
});
