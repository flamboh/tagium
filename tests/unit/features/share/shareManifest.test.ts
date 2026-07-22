import { describe, expect, it } from "vite-plus/test";
import {
  MAX_MANIFEST_PAYLOAD_BYTES,
  decodeManifest,
  projectAlbumManifest,
  toManifestReplayInput,
  type Manifest,
} from "@/features/share/shareManifest";

const manifest = (): Manifest =>
  decodeManifest({
    version: 1,
    kind: "album",
    album: {
      title: "Shared Album",
      artist: "Album Artist",
      genre: "Electronic",
      year: 2026,
      artwork: {
        kind: "stored",
        format: "image/jpeg",
        type: 3,
        description: "album cover",
      },
    },
    tracks: [
      {
        sourceUrl: "https://soundcloud.com/artist/first",
        audioBitrate: "320",
        metadata: {
          filename: "01-first",
          title: "First",
          artist: "First Artist",
          album: "Custom Album",
          genre: "Ambient",
          year: 2024,
          trackNumber: 7,
        },
      },
      {
        sourceUrl: "https://soundcloud.com/artist/first",
        audioBitrate: "128",
        metadata: {
          filename: "02-first-again",
          title: "First Again",
          artist: "Second Artist",
          album: "Another Album",
          genre: "Drone",
          year: 2025,
          trackNumber: 8,
        },
      },
    ],
  });

describe("share manifests", () => {
  it("round-trips the supported v1 transport DTO without client artwork size or hash", () => {
    expect(manifest().album.artwork).toEqual({
      kind: "stored",
      format: "image/jpeg",
      type: 3,
      description: "album cover",
    });
    expect(() => decodeManifest({ ...manifest(), version: 2 })).toThrow();
  });

  it("preserves ordered duplicate source URLs and complete replay metadata", () => {
    const decoded = manifest();
    const replay = toManifestReplayInput(decoded, { sourceManifestSlug: "shared-album" });

    expect(replay.sourceManifestSlug).toBe("shared-album");
    expect(replay.tracks.map((track) => track.sourceUrl)).toEqual([
      "https://soundcloud.com/artist/first",
      "https://soundcloud.com/artist/first",
    ]);
    expect(replay.tracks[1]).toEqual({
      sourceUrl: "https://soundcloud.com/artist/first",
      audioBitrate: "128",
      metadata: decoded.tracks[1]!.metadata,
    });
  });

  it("rejects invalid source URLs, numeric fields, and track counts", () => {
    const decoded = manifest();
    expect(() => decodeManifest({ ...decoded, tracks: [] })).toThrow();
    expect(() =>
      decodeManifest({
        ...decoded,
        tracks: [{ ...decoded.tracks[0], sourceUrl: "http://localhost/private" }],
      }),
    ).toThrow();
    expect(() =>
      decodeManifest({
        ...decoded,
        tracks: [{ ...decoded.tracks[0], metadata: { ...decoded.tracks[0]!.metadata, year: 12 } }],
      }),
    ).toThrow();
    expect(() =>
      decodeManifest({
        ...decoded,
        tracks: [{ ...decoded.tracks[0], audioBitrate: "999" }],
      }),
    ).toThrow();
  });

  it("projects effective buffered metadata and rejects local-only tracks", () => {
    const projected = projectAlbumManifest(
      { title: "Album", artist: "Artist", genre: "Pop", year: 2020 },
      [
        {
          filename: "original.mp3",
          downloadRequest: { sourceUrl: "https://youtu.be/abcdefghijk", audioBitrate: "256" },
          metadata: {
            filename: "original",
            title: "Original",
            artist: "Artist",
            album: "Album",
            genre: "Pop",
            year: 2020,
            duration: 0,
            bitrate: 0,
            sampleRate: 0,
            picture: [],
            trackNumber: 1,
          },
          pendingMetadataPatch: { filename: "edited", title: "Edited", trackNumber: 2 },
        },
      ],
    );

    expect(projected.tracks[0]).toMatchObject({
      audioBitrate: "256",
      metadata: { filename: "edited", title: "Edited", trackNumber: 2 },
    });
    expect(() =>
      projectAlbumManifest({ title: "", artist: "", genre: "" }, [{ filename: "local" }]),
    ).toThrow("only downloaded-source");
  });

  it("rejects a decoded manifest whose serialized payload exceeds the contract limit", () => {
    const decoded = manifest();
    const oversized = {
      ...decoded,
      album: { ...decoded.album, title: "a".repeat(MAX_MANIFEST_PAYLOAD_BYTES) },
    };
    expect(() => decodeManifest(oversized)).toThrow();
  });
});
