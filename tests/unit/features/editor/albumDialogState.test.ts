import { describe, expect, it } from "vite-plus/test";
import {
  albumDialogReducer,
  createAlbumDialogState,
  createOpenAlbumDialogAction,
  getAlbumDialogSubmission,
  type AlbumDialogAction,
  type AlbumDialogState,
} from "@/features/editor/albumDialogState";
import type { AlbumGroup, AudioMetadata, TagiumFile } from "@/features/library/types";

const picture = [
  {
    format: "image/jpeg",
    data: new Uint8Array([1, 2, 3]),
    type: 3,
    description: "front cover",
  },
];

const metadata = (overrides: Partial<AudioMetadata> = {}): AudioMetadata => ({
  filename: "track",
  title: "Track",
  artist: "Seed Artist",
  album: "",
  genre: ["Ambient", "Electronic"],
  year: 2025,
  duration: 100,
  bitrate: 320,
  sampleRate: 44_100,
  picture,
  trackNumber: null,
  ...overrides,
});

const file = (id: string, overrides: Partial<TagiumFile> = {}): TagiumFile => ({
  id,
  filename: `${id}.mp3`,
  status: "saved",
  downloadStatus: "ready",
  metadata: metadata(),
  ...overrides,
  format: overrides.format ?? "mp3",
});

const album = (overrides: Partial<AlbumGroup> = {}): AlbumGroup => ({
  id: "album-1",
  title: "Existing Album",
  artist: "Existing Artist",
  genre: "Rock",
  cover: picture,
  year: 1999,
  trackIds: ["one", "two"],
  ...overrides,
});

const reduce = (actions: AlbumDialogAction[]) =>
  actions.reduce<AlbumDialogState>(albumDialogReducer, createAlbumDialogState());

describe("albumDialogReducer", () => {
  it("opens an empty create dialog with a fresh placeholder seed", () => {
    const action = createOpenAlbumDialogAction([], [], "generated-seed");
    const state = albumDialogReducer(createAlbumDialogState(), action);

    expect(state).toEqual({
      open: true,
      mode: "create",
      draft: { title: "", artist: "", genre: "", cover: undefined, year: undefined },
      placeholderSeed: "generated-seed",
      editingAlbumId: null,
      createSeedTrackIds: [],
    });
  });

  it("deduplicates ordered create seeds and derives the draft and placeholder from the first", () => {
    const files = [file("one"), file("two", { metadata: metadata({ artist: "Second" }) })];
    const action = createOpenAlbumDialogAction(["one", "two", "one"], files, "unused");
    const state = albumDialogReducer(createAlbumDialogState(), action);

    expect(state.createSeedTrackIds).toEqual(["one", "two"]);
    expect(state.placeholderSeed).toBe("one");
    expect(state.draft).toEqual({
      title: "",
      artist: "Seed Artist",
      genre: "Ambient, Electronic",
      cover: picture,
      year: 2025,
    });
  });

  it("keeps seed membership but uses a blank draft when the first seed no longer exists", () => {
    const state = albumDialogReducer(
      createAlbumDialogState(),
      createOpenAlbumDialogAction(["missing"], [file("other")], "unused"),
    );

    expect(state.createSeedTrackIds).toEqual(["missing"]);
    expect(state.placeholderSeed).toBe("missing");
    expect(state.draft).toEqual({
      title: "",
      artist: "",
      genre: "",
      cover: undefined,
      year: undefined,
    });
  });

  it("opens edit mode atomically and clears stale create seeds", () => {
    const state = reduce([
      createOpenAlbumDialogAction(["one"], [file("one")], "unused"),
      { type: "edit-opened", album: album() },
    ]);

    expect(state).toEqual({
      open: true,
      mode: "edit",
      draft: {
        title: "Existing Album",
        artist: "Existing Artist",
        genre: "Rock",
        cover: picture,
        year: 1999,
      },
      placeholderSeed: "album-1",
      editingAlbumId: "album-1",
      createSeedTrackIds: [],
    });
  });

  it("applies replacement and functional draft updates to the latest draft", () => {
    const replacement = { title: "First", artist: "Artist", genre: "Jazz" };
    const state = reduce([
      { type: "edit-opened", album: album() },
      { type: "draft-changed", update: replacement },
      {
        type: "draft-changed",
        update: (draft) => ({ ...draft, artist: "Latest Artist", year: 2026 }),
      },
    ]);

    expect(state.draft).toEqual({
      title: "First",
      artist: "Latest Artist",
      genre: "Jazz",
      year: 2026,
    });
  });

  for (const finishType of ["closed", "saved", "deleted"] as const) {
    it(`keeps edit content stable while the ${finishType} dialog exits`, () => {
      const openState = reduce([{ type: "edit-opened", album: album() }]);
      const state = albumDialogReducer(openState, { type: finishType });

      expect(state).toEqual({ ...openState, open: false });
    });
  }
});

describe("getAlbumDialogSubmission", () => {
  it("captures create seeds and trims submitted metadata", () => {
    const state = reduce([
      createOpenAlbumDialogAction(["one", "two"], [file("one"), file("two")], "unused"),
      {
        type: "draft-changed",
        update: { title: "  New Album  ", artist: "  Artist  ", genre: "  Pop  ", year: 2026 },
      },
    ]);

    expect(getAlbumDialogSubmission(state)).toEqual({
      mode: "create",
      seedTrackIds: ["one", "two"],
      metadata: {
        title: "New Album",
        artist: "Artist",
        genre: "Pop",
        cover: undefined,
        year: 2026,
      },
    });
  });

  it("captures the editing album and preserves its existing cover", () => {
    const state = reduce([{ type: "edit-opened", album: album() }]);

    expect(getAlbumDialogSubmission(state)).toEqual({
      mode: "edit",
      albumId: "album-1",
      metadata: {
        title: "Existing Album",
        artist: "Existing Artist",
        genre: "Rock",
        cover: picture,
        year: 1999,
      },
    });
  });

  it("does not submit closed state and retains the untitled fallback", () => {
    expect(getAlbumDialogSubmission(createAlbumDialogState())).toBeNull();

    const open = reduce([
      createOpenAlbumDialogAction([], [], "placeholder"),
      { type: "draft-changed", update: { title: "  ", artist: "Artist", genre: "" } },
    ]);
    expect(getAlbumDialogSubmission(open)?.metadata.title).toBe("untitled album");
  });
});
