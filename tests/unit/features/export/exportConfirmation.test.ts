import { describe, expect, it } from "vite-plus/test";
import {
  deriveExportConfirmationSummary,
  formatByteSize,
} from "@/features/export/exportConfirmation";
import { createLibraryState } from "@/features/library/libraryState";
import type { AlbumGroup, AudioMetadata, TagiumFile } from "@/features/library/types";

const settings = {
  syncTrackNumbers: false,
  syncFilenames: false,
  audioBitrate: "320" as const,
  applySoundCloudAlbumCoverToTracks: false,
};

const metadata = (title: string): AudioMetadata => ({
  filename: title,
  title,
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

const track = (id: string, title: string, bytes: number): TagiumFile => ({
  id,
  filename: `${title}.mp3`,
  file: new File([new Uint8Array(bytes)], `${title}.mp3`),
  originalFile: new File([new Uint8Array(bytes)], `${title}.mp3`),
  status: "saved",
  downloadStatus: "ready",
  metadata: metadata(title),
});

const album = (id: string, title: string, trackIds: string[]): AlbumGroup => ({
  id,
  title,
  artist: "",
  genre: "",
  trackIds,
});

describe("export confirmation summary", () => {
  it("groups albums and loose tracks while deriving exact totals", () => {
    const state = {
      ...createLibraryState(),
      files: [track("one", "One", 1_200), track("two", "Two", 300), track("loose", "Loose", 7)],
      albums: [album("album", "Album", ["one", "two"])],
      looseTrackIds: ["loose"],
    };

    const summary = deriveExportConfirmationSummary(state, { kind: "library" }, settings);
    expect(summary?.fingerprint).toBeTypeOf("string");
    expect(summary).toMatchObject({
      target: { kind: "library" },
      groups: [
        {
          id: "album:album",
          title: "Album",
          tracks: [
            { id: "one", title: "One", sizeBytes: 1_200 },
            { id: "two", title: "Two", sizeBytes: 300 },
          ],
          sizeBytes: 1_500,
        },
        {
          id: "loose",
          title: "Loose tracks",
          tracks: [{ id: "loose", title: "Loose", sizeBytes: 7 }],
          sizeBytes: 7,
        },
      ],
      trackCount: 3,
      totalSizeBytes: 1_507,
    });
  });

  it("includes unassigned files as loose tracks without duplicating explicit loose tracks", () => {
    const state = {
      ...createLibraryState(),
      files: [track("loose", "Loose", 5), track("orphan", "Orphan", 8)],
      looseTrackIds: ["loose"],
    };

    const summary = deriveExportConfirmationSummary(state, { kind: "library" }, settings);
    expect(summary?.groups[0]?.tracks.map(({ id }) => id)).toEqual(["loose", "orphan"]);
    expect(summary?.totalSizeBytes).toBe(13);
  });

  it("rejects missing, empty, or unready targets", () => {
    const ready = track("ready", "Ready", 5);
    const unready = { ...track("unready", "Unready", 5), file: undefined };
    const state = {
      ...createLibraryState(),
      files: [ready, unready],
      albums: [album("album", "Album", ["ready", "missing"])],
      looseTrackIds: ["unready"],
    };

    expect(
      deriveExportConfirmationSummary(state, { kind: "album", albumId: "missing" }, settings),
    ).toBeNull();
    expect(
      deriveExportConfirmationSummary(state, { kind: "album", albumId: "album" }, settings),
    ).toBeNull();
    expect(deriveExportConfirmationSummary(state, { kind: "library" }, settings)).toBeNull();
    expect(
      deriveExportConfirmationSummary(createLibraryState(), { kind: "library" }, settings),
    ).toBeNull();
  });

  it("skips empty albums in a library export but rejects an empty album target", () => {
    const state = {
      ...createLibraryState(),
      files: [track("loose", "Loose", 4)],
      albums: [album("empty", "Empty", [])],
      looseTrackIds: ["loose"],
    };

    const librarySummary = deriveExportConfirmationSummary(state, { kind: "library" }, settings);
    expect(librarySummary?.groups.map(({ title }) => title)).toEqual(["Loose tracks"]);
    expect(
      deriveExportConfirmationSummary(state, { kind: "album", albumId: "empty" }, settings),
    ).toBeNull();
  });

  it("formats a readable size while preserving the exact byte count", () => {
    expect(formatByteSize(1)).toBe("1 byte");
    expect(formatByteSize(999)).toBe("999 bytes");
    expect(formatByteSize(1_234_567)).toBe("1.2 MB (1,234,567 bytes)");
  });

  it("keeps shared large-cover fingerprints bounded and detects same-size replacement artwork", () => {
    const coverBytes = new Uint8Array(8 * 1024 * 1024);
    coverBytes[0] = 12;
    coverBytes[coverBytes.length - 1] = 34;
    const picture = {
      format: "image/jpeg",
      type: 3,
      description: "front cover",
      data: coverBytes,
    };
    const files = Array.from({ length: 40 }, (_, index) => {
      const current = track(`track-${index}`, `Track ${index}`, 100);
      return { ...current, metadata: { ...current.metadata!, picture: [picture] } };
    });
    const state = {
      ...createLibraryState(),
      files,
      albums: [
        {
          ...album(
            "album",
            "Large shared cover",
            files.map(({ id }) => id),
          ),
          cover: [picture],
        },
      ],
    };

    const first = deriveExportConfirmationSummary(state, { kind: "library" }, settings);
    const repeated = deriveExportConfirmationSummary(state, { kind: "library" }, settings);
    expect(first?.fingerprint).toBe(repeated?.fingerprint);
    expect(first?.fingerprint.length).toBeLessThan(60_000);
    expect(first?.fingerprint).not.toContain('"0":12');

    const replacementBytes = coverBytes.slice();
    replacementBytes[Math.floor(replacementBytes.length / 3)] = 99;
    const replacement = { ...picture, data: replacementBytes };
    const replacedState = {
      ...state,
      files: files.map((file) => ({
        ...file,
        metadata: { ...file.metadata, picture: [replacement] },
      })),
      albums: [{ ...state.albums[0]!, cover: [replacement] }],
    };
    const replaced = deriveExportConfirmationSummary(replacedState, { kind: "library" }, settings);

    expect(replaced?.fingerprint).not.toBe(first?.fingerprint);
    expect(replaced?.fingerprint.length).toBeLessThan(60_000);
  });
});
