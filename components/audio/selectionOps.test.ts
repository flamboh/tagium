import { describe, expect, it } from "vite-plus/test";
import {
  clearSelection,
  selectAlbum,
  selectAlbumTrack,
  selectAllFiles,
  selectLooseTrack,
  type TrackSelection,
} from "./selectionOps";

const selection = (overrides: Partial<TrackSelection> = {}): TrackSelection => ({
  selectedAlbumId: null,
  selectedFileId: null,
  selectedFileIds: new Set(),
  lastSelectedFileId: null,
  ...overrides,
});

const ids = (selected: TrackSelection) => Array.from(selected.selectedFileIds);

describe("selectionOps", () => {
  it("single album select selects the album and first track", () => {
    const result = selectAlbum(selection(), "album-1", ["track-1", "track-2"]);

    expect(result.selectedAlbumId).toBe("album-1");
    expect(result.selectedFileId).toBe("track-1");
    expect(ids(result)).toEqual(["track-1"]);
    expect(result.lastSelectedFileId).toBe("track-1");
  });

  it("multi album select toggles the first track and updates the anchor", () => {
    const current = selection({
      selectedFileIds: new Set(["track-1", "loose-1"]),
      lastSelectedFileId: "loose-1",
    });

    const result = selectAlbum(current, "album-1", ["track-1", "track-2"], { multi: true });

    expect(result.selectedAlbumId).toBe("album-1");
    expect(result.selectedFileId).toBe("track-1");
    expect(ids(result)).toEqual(["loose-1"]);
    expect(result.lastSelectedFileId).toBe("track-1");
    expect(ids(current)).toEqual(["track-1", "loose-1"]);
  });

  it("multi empty album select preserves existing file selection and anchor", () => {
    const current = selection({
      selectedAlbumId: "album-before",
      selectedFileId: "track-1",
      selectedFileIds: new Set(["track-1", "loose-1"]),
      lastSelectedFileId: "loose-1",
    });

    const result = selectAlbum(current, "empty-album", [], { multi: true });

    expect(result.selectedAlbumId).toBe("empty-album");
    expect(result.selectedFileId).toBe("track-1");
    expect(ids(result)).toEqual(["track-1", "loose-1"]);
    expect(result.lastSelectedFileId).toBe("loose-1");
    expect(result.selectedFileIds).toBe(current.selectedFileIds);
  });

  it("single album track select selects exactly that track and album", () => {
    const result = selectAlbumTrack(
      selection({ selectedFileIds: new Set(["track-1", "loose-1"]) }),
      "album-1",
      "track-2",
      ["track-1", "track-2"],
    );

    expect(result.selectedAlbumId).toBe("album-1");
    expect(result.selectedFileId).toBe("track-2");
    expect(ids(result)).toEqual(["track-2"]);
    expect(result.lastSelectedFileId).toBe("track-2");
  });

  it("ctrl/meta album track toggle can deselect and still moves the anchor", () => {
    const current = selection({
      selectedAlbumId: "album-1",
      selectedFileId: "track-2",
      selectedFileIds: new Set(["track-1", "track-2"]),
      lastSelectedFileId: "track-2",
    });

    const result = selectAlbumTrack(current, "album-1", "track-2", ["track-1", "track-2"], {
      multi: true,
    });

    expect(result.selectedAlbumId).toBe("album-1");
    expect(result.selectedFileId).toBe("track-2");
    expect(ids(result)).toEqual(["track-1"]);
    expect(result.lastSelectedFileId).toBe("track-2");
    expect(ids(current)).toEqual(["track-1", "track-2"]);
  });

  it("shift range selection for album tracks stays within the album", () => {
    const current = selection({
      selectedAlbumId: "album-1",
      selectedFileId: "track-1",
      selectedFileIds: new Set(["track-1", "loose-1"]),
      lastSelectedFileId: "track-1",
    });

    const result = selectAlbumTrack(
      current,
      "album-1",
      "track-3",
      ["track-1", "track-2", "track-3"],
      { range: true, multi: true },
    );

    expect(result.selectedAlbumId).toBe("album-1");
    expect(result.selectedFileId).toBe("track-3");
    expect(ids(result)).toEqual(["track-1", "loose-1", "track-2", "track-3"]);
    expect(result.lastSelectedFileId).toBe("track-3");
  });

  it("cross-container album range is a no-op and keeps shift precedence over multi", () => {
    const current = selection({
      selectedAlbumId: null,
      selectedFileId: "loose-1",
      selectedFileIds: new Set(["loose-1"]),
      lastSelectedFileId: "loose-1",
    });

    const result = selectAlbumTrack(current, "album-1", "track-2", ["track-1", "track-2"], {
      range: true,
      multi: true,
    });

    expect(result).toBe(current);
    expect(ids(result)).toEqual(["loose-1"]);
  });

  it("loose track select and range selection use loose track ordering", () => {
    const current = selectLooseTrack(selection(), "loose-1", ["loose-1", "loose-2", "loose-3"]);
    const result = selectLooseTrack(current, "loose-3", ["loose-1", "loose-2", "loose-3"], {
      range: true,
    });

    expect(result.selectedAlbumId).toBeNull();
    expect(result.selectedFileId).toBe("loose-3");
    expect(ids(result)).toEqual(["loose-1", "loose-2", "loose-3"]);
    expect(result.lastSelectedFileId).toBe("loose-3");
  });

  it("cross-container loose range is a no-op", () => {
    const current = selection({
      selectedAlbumId: "album-1",
      selectedFileId: "track-1",
      selectedFileIds: new Set(["track-1"]),
      lastSelectedFileId: "track-1",
    });

    const result = selectLooseTrack(current, "loose-2", ["loose-1", "loose-2"], {
      range: true,
      multi: true,
    });

    expect(result).toBe(current);
    expect(ids(result)).toEqual(["track-1"]);
  });

  it("clear selection clears all selection fields", () => {
    const result = clearSelection();

    expect(result.selectedAlbumId).toBeNull();
    expect(result.selectedFileId).toBeNull();
    expect(ids(result)).toEqual([]);
    expect(result.lastSelectedFileId).toBeNull();
  });

  it("select all files selects every visible file and anchors the first", () => {
    const result = selectAllFiles(selection({ selectedAlbumId: "album-1" }), [
      "track-1",
      "track-2",
      "loose-1",
    ]);

    expect(result.selectedAlbumId).toBe("album-1");
    expect(result.selectedFileId).toBe("track-1");
    expect(ids(result)).toEqual(["track-1", "track-2", "loose-1"]);
    expect(result.lastSelectedFileId).toBe("track-1");
  });

  it("select all with no files clears active and anchor", () => {
    const result = selectAllFiles(
      selection({
        selectedAlbumId: "album-1",
        selectedFileId: "track-1",
        selectedFileIds: new Set(["track-1"]),
        lastSelectedFileId: "track-1",
      }),
      [],
    );

    expect(result.selectedAlbumId).toBe("album-1");
    expect(result.selectedFileId).toBeNull();
    expect(ids(result)).toEqual([]);
    expect(result.lastSelectedFileId).toBeNull();
  });
});
