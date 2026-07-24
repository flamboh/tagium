import { describe, expect, it } from "vite-plus/test";
import {
  formatMegabyteSize,
  planExport,
  samePlan,
  type ExportTarget,
} from "@/features/export/exportConfirmation";
import { createLibraryState, type LibraryState } from "@/features/library/libraryState";
import type { AlbumGroup, AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";

const settings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  syncTrackNumbers: false,
  syncFilenames: false,
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
  format: { kind: "mp3", extension: "mp3", mime: "audio/mpeg" },
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

const stateWith = (contents: Partial<LibraryState>): LibraryState => ({
  ...createLibraryState(),
  ...contents,
});

const plan = (
  state: LibraryState,
  target: ExportTarget = { kind: "library" },
  currentSettings = settings,
) => {
  const result = planExport(state, target, currentSettings);
  if (!result) throw new Error("expected export plan");
  return result;
};

describe("export confirmation planning", () => {
  it("groups and deduplicates tracks in ZIP order and includes owned artwork in the estimate", () => {
    const cover = {
      format: "image/jpeg",
      type: 3,
      description: "cover",
      data: new Uint8Array([1, 2, 3, 4]),
    };
    const state = stateWith({
      files: [track("orphan", "Orphan", 8), track("one", "One", 1_200), track("two", "Two", 300)],
      albums: [{ ...album("album", "Album", ["one", "two", "one"]), cover: [cover] }],
      looseTrackIds: ["orphan", "orphan", "one"],
    });

    const result = plan(state);
    expect(result.groups).toEqual([
      {
        id: "album:album",
        title: "Album",
        tracks: [
          { id: "one", title: "One" },
          { id: "two", title: "Two" },
        ],
      },
      {
        id: "loose",
        title: "Loose tracks",
        tracks: [{ id: "orphan", title: "Orphan" }],
      },
    ]);
    expect(result.trackCount).toBe(3);
    expect(result.totalSizeBytes).toBe(1_508);
  });

  it("rejects missing, empty, and unready targets while ignoring empty library albums", () => {
    const ready = track("ready", "Ready", 5);
    const unready = { ...track("unready", "Unready", 5), file: undefined };
    const state = stateWith({
      files: [ready, unready],
      albums: [album("album", "Album", ["ready", "missing"]), album("empty", "Empty", [])],
      looseTrackIds: ["unready"],
    });

    expect(planExport(state, { kind: "album", albumId: "missing" }, settings)).toBeNull();
    expect(planExport(state, { kind: "album", albumId: "album" }, settings)).toBeNull();
    expect(planExport(state, { kind: "album", albumId: "empty" }, settings)).toBeNull();
    expect(planExport(state, { kind: "library" }, settings)).toBeNull();

    const looseOnly = stateWith({
      files: [ready],
      albums: [album("empty", "Empty", [])],
      looseTrackIds: ["ready"],
    });
    expect(plan(looseOnly).groups.map(({ title }) => title)).toEqual(["Loose tracks"]);
  });

  it("invalidates every export-relevant file, path, metadata, patch, and setting change", () => {
    const initialTrack = track("track", "Track", 5);
    const initialState = stateWith({ files: [initialTrack], looseTrackIds: ["track"] });
    const initial = plan(initialState);
    const changes: TagiumFile[] = [
      { ...initialTrack, filename: "renamed.mp3" },
      { ...initialTrack, metadata: { ...initialTrack.metadata!, artist: "Changed" } },
      { ...initialTrack, pendingMetadataPatch: { genre: "Changed" } },
      {
        ...initialTrack,
        format: { kind: "flac", extension: "flac", mime: "audio/flac" },
      },
      { ...initialTrack, file: new File(["audio"], "track.mp3") },
    ];

    for (const changedTrack of changes) {
      expect(
        samePlan(initial, plan(stateWith({ files: [changedTrack], looseTrackIds: ["track"] }))),
      ).toBe(false);
    }
    expect(
      samePlan(
        initial,
        plan(initialState, { kind: "library" }, { ...settings, syncFilenames: true }),
      ),
    ).toBe(false);
    expect(
      samePlan(
        plan(
          stateWith({
            files: [track("one", "One", 1), track("two", "Two", 1)],
            looseTrackIds: ["one", "two"],
          }),
        ),
        plan(
          stateWith({
            files: [track("one", "One", 1), track("two", "Two", 1)],
            looseTrackIds: ["two", "one"],
          }),
        ),
      ),
    ).toBe(false);
  });

  it("fingerprints generic metadata and every artwork byte without retaining huge byte strings", () => {
    const bytes = new Uint8Array(8 * 1024 * 1024);
    bytes[0] = 12;
    bytes[bytes.length - 1] = 34;
    const picture = { format: "image/jpeg", type: 3, description: "", data: bytes };
    const current = track("track", "Track", 100);
    const state = stateWith({
      files: [{ ...current, metadata: { ...current.metadata!, picture: [picture] } }],
      albums: [{ ...album("album", "Artwork", ["track"]), cover: [picture] }],
    });
    const before = plan(state);
    expect(samePlan(before, plan(state))).toBe(true);

    bytes[1_234_567] = 99;
    const after = plan(state);
    expect(samePlan(before, after)).toBe(false);
  });

  it("excludes selection, sharing/provenance, unrelated settings, and empty albums", () => {
    const current = track("track", "Track", 10);
    const baseAlbum = album("album", "Album", ["track"]);
    const base = stateWith({ files: [current], albums: [baseAlbum] });
    const changed = {
      ...base,
      selectedAlbumId: "album",
      selectedFileId: "track",
      selectedFileIds: new Set(["track"]),
      albums: [
        {
          ...baseAlbum,
          sourceUrl: "https://example.com/source",
          sourceManifestSlug: "provenance",
          sharePublication: {
            slug: "shared",
            url: "https://example.com/shared",
            expiresAt: "2099-01-01T00:00:00.000Z",
            publishedFingerprint: "changed",
            status: "active" as const,
          },
        },
        album("empty", "Not exported", []),
      ],
    };
    const unrelatedSettings = {
      ...settings,
      audioBitrate: "64" as const,
      applySoundCloudAlbumCoverToTracks: !settings.applySoundCloudAlbumCoverToTracks,
    };

    expect(samePlan(plan(base), plan(changed, { kind: "library" }, unrelatedSettings))).toBe(true);
  });

  it("formats a compact MB-only estimate", () => {
    expect(formatMegabyteSize(1)).toBe("0.00 MB");
    expect(formatMegabyteSize(1_234_567)).toBe("1.2 MB");
    expect(formatMegabyteSize(99_950_000)).toBe("100 MB");
    expect(formatMegabyteSize(1_000_000_000)).toBe("1K MB");
  });
});
