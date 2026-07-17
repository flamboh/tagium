import { describe, expect, it } from "vitest";
import {
  createLibraryState,
  libraryReducer,
  type LibraryAction,
  type LibraryState,
} from "./libraryState";
import type { AlbumGroup, TagiumFile } from "./types";

const file = (id: string): TagiumFile => ({
  id,
  filename: `${id}.mp3`,
  status: "saved",
  downloadStatus: "ready",
});

const album = (id: string, trackIds: string[]): AlbumGroup => ({
  id,
  title: id,
  artist: "artist",
  genre: "genre",
  trackIds,
});

const reduce = (actions: LibraryAction[]) =>
  actions.reduce<LibraryState>(libraryReducer, createLibraryState());

const importLibrary = (
  files: TagiumFile[],
  albums: AlbumGroup[],
  looseTrackIds: string[],
  selectedFileId: string,
  selectedAlbumId: string | null,
): LibraryAction => ({
  type: "content-replaced",
  files,
  albums,
  looseTrackIds,
  selection: {
    selectedAlbumId,
    selectedFileId,
    selectedFileIds: new Set([selectedFileId]),
    rangeAnchorFileId: selectedFileId,
  },
});

describe("libraryReducer", () => {
  it("keeps an explicit manual clear across later content updates", () => {
    const state = reduce([
      importLibrary([file("loose-1")], [], ["loose-1"], "loose-1", null),
      { type: "selection-cleared" },
      {
        type: "content-replaced",
        files: [file("loose-1"), file("loose-2")],
        looseTrackIds: ["loose-1", "loose-2"],
      },
    ]);

    expect(state.selectedFileId).toBeNull();
    expect(state.selectedAlbumId).toBeNull();
    expect(state.selectedFileIds).toEqual(new Set());
    expect(state.rangeAnchorFileId).toBeNull();
    expect(state.selectionWasManuallyCleared).toBe(true);
  });

  it("falls back atomically when the selected track is removed", () => {
    const state = reduce([
      importLibrary(
        [file("track-1"), file("track-2")],
        [album("album-1", ["track-1", "track-2"])],
        [],
        "track-1",
        "album-1",
      ),
      { type: "tracks-removed", trackIds: ["track-1"] },
    ]);

    expect(state.files.map(({ id }) => id)).toEqual(["track-2"]);
    expect(state.albums[0]?.trackIds).toEqual(["track-2"]);
    expect(state.selectedAlbumId).toBe("album-1");
    expect(state.selectedFileId).toBe("track-2");
    expect(state.selectedFileIds).toEqual(new Set(["track-2"]));
    expect(state.rangeAnchorFileId).toBe("track-2");
  });

  it("keeps an empty selected album selected without inventing a track", () => {
    const state = reduce([
      {
        type: "content-replaced",
        albums: [album("empty", [])],
        selection: { selectedAlbumId: "empty", selectedFileId: null },
      },
      { type: "content-replaced", albums: [album("empty", [])] },
    ]);

    expect(state.selectedAlbumId).toBe("empty");
    expect(state.selectedFileId).toBeNull();
    expect(state.selectionWasManuallyCleared).toBe(false);
  });

  it("uses a loose track before non-empty albums when the selected album disappears", () => {
    const state = reduce([
      importLibrary(
        [file("album-track"), file("loose-track")],
        [album("selected", ["album-track"]), album("empty", [])],
        ["loose-track"],
        "album-track",
        "selected",
      ),
      { type: "album-removed", albumId: "selected" },
    ]);

    expect(state.files.map(({ id }) => id)).toEqual(["loose-track"]);
    expect(state.albums).toEqual([album("empty", [])]);
    expect(state.selectedAlbumId).toBeNull();
    expect(state.selectedFileId).toBe("loose-track");
  });

  it("skips empty albums when finding a library fallback", () => {
    const state = reduce([
      importLibrary(
        [file("removed"), file("kept")],
        [album("selected", ["removed"]), album("empty", []), album("kept", ["kept"])],
        [],
        "removed",
        "selected",
      ),
      { type: "album-removed", albumId: "selected" },
    ]);

    expect(state.selectedAlbumId).toBe("kept");
    expect(state.selectedFileId).toBe("kept");
  });

  it("imports files, organization, and selection as one state transition", () => {
    const state = libraryReducer(
      createLibraryState(),
      importLibrary(
        [file("one"), file("two")],
        [album("release", ["one", "two"])],
        [],
        "one",
        "release",
      ),
    );

    expect(state.files).toHaveLength(2);
    expect(state.albums[0]?.trackIds).toEqual(["one", "two"]);
    expect(state.selectedFileId).toBe("one");
    expect(state.selectedFileIds).toEqual(new Set(["one"]));
    expect(state.selectionWasManuallyCleared).toBe(false);
  });

  it("uses the reducer-owned range anchor and advances it after a range selection", () => {
    const imported = libraryReducer(
      createLibraryState(),
      importLibrary(
        [file("one"), file("two"), file("three"), file("four")],
        [album("release", ["one", "two", "three", "four"])],
        [],
        "one",
        "release",
      ),
    );
    const firstRange = libraryReducer(imported, {
      type: "track-selected",
      albumId: "release",
      fileId: "three",
      mode: "range",
    });
    const secondRange = libraryReducer(firstRange, {
      type: "track-selected",
      albumId: "release",
      fileId: "four",
      mode: "range",
    });

    expect(firstRange.selectedFileIds).toEqual(new Set(["one", "two", "three"]));
    expect(firstRange.rangeAnchorFileId).toBe("three");
    expect(secondRange.selectedFileIds).toEqual(new Set(["one", "two", "three", "four"]));
    expect(secondRange.rangeAnchorFileId).toBe("four");
  });

  it("normalizes selection and membership when a selected track moves to loose tracks", () => {
    const state = reduce([
      importLibrary(
        [file("one"), file("two")],
        [album("release", ["one", "two"])],
        [],
        "one",
        "release",
      ),
      {
        type: "content-replaced",
        albums: [album("release", ["two"])],
        looseTrackIds: ["one", "one", "missing"],
      },
    ]);

    expect(state.looseTrackIds).toEqual(["one"]);
    expect(state.selectedAlbumId).toBeNull();
    expect(state.selectedFileId).toBe("one");
  });

  it("normalizes selection when a loose track moves into an album", () => {
    const state = reduce([
      importLibrary([file("one")], [], ["one"], "one", null),
      {
        type: "content-replaced",
        albums: [album("release", ["one"])],
        looseTrackIds: [],
      },
    ]);

    expect(state.selectedAlbumId).toBe("release");
    expect(state.selectedFileId).toBe("one");
  });

  it("normalizes duplicate and contradictory content membership", () => {
    const state = libraryReducer(createLibraryState(), {
      type: "content-replaced",
      files: [
        file("one"),
        { ...file("one"), filename: "latest-one.mp3" },
        file("two"),
        file("three"),
      ],
      albums: [album("first", ["one", "one", "missing", "two"]), album("second", ["two", "three"])],
      looseTrackIds: ["one", "three", "three", "missing"],
      selection: { selectedAlbumId: "first", selectedFileId: "one" },
    });

    expect(state.files.map(({ id, filename }) => [id, filename])).toEqual([
      ["one", "latest-one.mp3"],
      ["two", "two.mp3"],
      ["three", "three.mp3"],
    ]);
    expect(state.albums.map(({ id, trackIds }) => [id, trackIds])).toEqual([
      ["first", ["one", "two"]],
      ["second", ["three"]],
    ]);
    expect(state.looseTrackIds).toEqual([]);
  });

  it("ignores a range selection whose anchor belongs to another scope", () => {
    const imported = libraryReducer(
      createLibraryState(),
      importLibrary(
        [file("album-track"), file("loose-track")],
        [album("release", ["album-track"])],
        ["loose-track"],
        "album-track",
        "release",
      ),
    );

    const state = libraryReducer(imported, {
      type: "track-selected",
      albumId: null,
      fileId: "loose-track",
      mode: "range",
    });

    expect(state).toBe(imported);
  });

  it("preserves staged uploads and concurrent organization across partial async updates", () => {
    let state = reduce([
      importLibrary(
        [file("existing-a"), file("existing-b")],
        [album("a", ["existing-a"]), album("b", ["existing-b"])],
        [],
        "existing-a",
        "a",
      ),
    ]);

    state = libraryReducer(state, {
      type: "content-replaced",
      files: [...state.files, file("upload")],
    });
    state = libraryReducer(state, {
      type: "content-replaced",
      albums: [state.albums[1], state.albums[0]],
    });
    state = libraryReducer(state, {
      type: "content-replaced",
      files: state.files.map((entry) =>
        entry.id === "existing-a" ? { ...entry, filename: "updated.mp3" } : entry,
      ),
    });
    state = libraryReducer(state, {
      type: "content-replaced",
      albums: [...state.albums, album("imported", ["upload"])],
      selection: { selectedAlbumId: "imported", selectedFileId: "upload" },
    });

    expect(state.files.map(({ id }) => id)).toEqual(["existing-a", "existing-b", "upload"]);
    expect(state.files[0]?.filename).toBe("updated.mp3");
    expect(state.albums.map(({ id }) => id)).toEqual(["b", "a", "imported"]);
    expect(state.selectedAlbumId).toBe("imported");
    expect(state.selectedFileId).toBe("upload");
  });

  it("removes every album track and falls back to the remaining library on album deletion", () => {
    const state = reduce([
      importLibrary(
        [file("one"), file("two"), file("loose")],
        [album("release", ["one", "two"])],
        ["loose"],
        "two",
        "release",
      ),
      { type: "album-removed", albumId: "release" },
    ]);

    expect(state.files.map(({ id }) => id)).toEqual(["loose"]);
    expect(state.albums).toEqual([]);
    expect(state.looseTrackIds).toEqual(["loose"]);
    expect(state.selectedFileId).toBe("loose");
    expect(state.selectedAlbumId).toBeNull();
  });

  it("supports replace, toggle, select-all, and loose-track selection", () => {
    const imported = libraryReducer(
      createLibraryState(),
      importLibrary([file("one"), file("two")], [], ["one", "two"], "one", null),
    );
    const toggled = libraryReducer(imported, {
      type: "track-selected",
      albumId: null,
      fileId: "two",
      mode: "toggle",
    });
    const selectedAll = libraryReducer(toggled, { type: "all-tracks-selected" });

    expect(toggled.selectedFileIds).toEqual(new Set(["one", "two"]));
    expect(toggled.selectedFileId).toBe("two");
    expect(selectedAll.selectedFileIds).toEqual(new Set(["one", "two"]));
    expect(selectedAll.selectedFileId).toBe("one");
  });
});
