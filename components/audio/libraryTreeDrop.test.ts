import { describe, expect, it } from "vite-plus/test";
import { moveTrackInSidebar } from "./albumOps";
import { buildLibraryTree } from "./libraryTree";
import { handleLibraryTreeDrop, handleLibraryTreeModelDrop } from "./libraryTreeDrop";
import type { AlbumGroup, TagiumFile } from "./types";

const file = (id: string): TagiumFile => ({
  id,
  filename: `${id}.mp3`,
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

const dropEvent = ({ draggedPath, targetPath }: { draggedPath: string; targetPath: string }) =>
  ({
    clientY: 10,
    dataTransfer: {
      files: [],
      getData: () => draggedPath,
    },
    nativeEvent: {
      composedPath: () => [
        {
          dataset: {
            itemPath: targetPath,
            type: "item",
          },
          getBoundingClientRect: () => ({
            bottom: 20,
            height: 20,
            top: 0,
          }),
        },
      ],
    },
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  }) as unknown as React.DragEvent<HTMLElement>;

describe("libraryTreeDrop", () => {
  it("emits all selected tracks in visible order for an album drop", () => {
    const files = [file("track-a"), file("track-b"), file("track-c")];
    const albums = [
      album("source", "Source", ["track-a", "track-b"]),
      album("target", "Target", []),
    ];
    const tree = buildLibraryTree({
      albums,
      files,
      looseTrackIds: ["track-c"],
    });
    const movedTrackIds: string[] = [];
    let selectedTrackId: string | null = null;

    handleLibraryTreeDrop({
      albums,
      event: dropEvent({
        draggedPath: tree.pathByTrackId.get("track-a") ?? "",
        targetPath: tree.pathByAlbumId.get("target") ?? "",
      }),
      handlers: {
        onAudioUpload: () => undefined,
        onMoveTrackToAlbum: (trackId) => {
          movedTrackIds.push(trackId);
        },
        onMoveTrackToLoose: () => undefined,
        onPromptCreateAlbumFromLooseTracks: () => undefined,
        onReorderAlbums: () => undefined,
        onSelectTracks: (selection) => {
          selectedTrackId = selection.selectedFileId;
        },
        onUploadToAlbum: () => undefined,
      },
      selectedPaths: [
        tree.pathByTrackId.get("track-a") ?? "",
        tree.pathByTrackId.get("track-b") ?? "",
      ],
      tree,
    });

    expect(movedTrackIds).toEqual(["track-a", "track-b"]);
    expect(selectedTrackId).toBe("track-a");
  });

  it("keeps sequential multi-track moves when handlers compose from latest sidebar state", () => {
    let currentAlbums = [
      album("source", "Source", ["track-a", "track-b"]),
      album("target", "Target", []),
    ];
    let currentLooseTrackIds: string[] = [];

    for (const trackId of ["track-a", "track-b"]) {
      const moved = moveTrackInSidebar(
        currentAlbums,
        currentLooseTrackIds,
        trackId,
        {
          type: "album",
          albumId: "target",
          placement: "append",
        },
        { syncTrackNumbers: true },
      );
      currentAlbums = moved.albums;
      currentLooseTrackIds = moved.looseTrackIds;
    }

    expect(currentAlbums.find((entry) => entry.id === "source")?.trackIds).toEqual([]);
    expect(currentAlbums.find((entry) => entry.id === "target")?.trackIds).toEqual([
      "track-a",
      "track-b",
    ]);
  });

  it("moves selected tracks to loose when dropped on tree background", () => {
    const files = [file("track-a"), file("track-b")];
    const albums = [album("source", "Source", ["track-a", "track-b"])];
    const tree = buildLibraryTree({
      albums,
      files,
      looseTrackIds: [],
    });
    const movedTrackIds: string[] = [];
    let selectedTrackId: string | null = null;

    handleLibraryTreeDrop({
      albums,
      event: dropEvent({
        draggedPath: tree.pathByTrackId.get("track-a") ?? "",
        targetPath: "",
      }),
      handlers: {
        onAudioUpload: () => undefined,
        onMoveTrackToAlbum: () => undefined,
        onMoveTrackToLoose: (trackId) => {
          movedTrackIds.push(trackId);
        },
        onPromptCreateAlbumFromLooseTracks: () => undefined,
        onReorderAlbums: () => undefined,
        onSelectTracks: (selection) => {
          selectedTrackId = selection.selectedFileId;
        },
        onUploadToAlbum: () => undefined,
      },
      selectedPaths: [
        tree.pathByTrackId.get("track-a") ?? "",
        tree.pathByTrackId.get("track-b") ?? "",
      ],
      tree,
    });

    expect(movedTrackIds).toEqual(["track-a", "track-b"]);
    expect(selectedTrackId).toBe("track-a");
  });

  it("keeps model-completed multi-track drops focused on the primary dragged track", () => {
    const files = [file("track-a"), file("track-b"), file("track-c")];
    const albums = [
      album("source", "Source", ["track-a", "track-b"]),
      album("target", "Target", ["track-c"]),
    ];
    const tree = buildLibraryTree({
      albums,
      files,
      looseTrackIds: [],
    });
    const movedTrackIds: string[] = [];
    let selectedTrackId: string | null = null;

    handleLibraryTreeModelDrop({
      albums,
      event: {
        draggedPaths: [
          tree.pathByTrackId.get("track-a") ?? "",
          tree.pathByTrackId.get("track-b") ?? "",
        ],
        operation: "move",
        target: {
          directoryPath: tree.pathByAlbumId.get("target") ?? "",
          flattenedSegmentPath: null,
          hoveredPath: tree.pathByAlbumId.get("target") ?? "",
          kind: "directory",
        },
      },
      handlers: {
        onAudioUpload: () => undefined,
        onMoveTrackToAlbum: (trackId) => {
          movedTrackIds.push(trackId);
        },
        onMoveTrackToLoose: () => undefined,
        onPromptCreateAlbumFromLooseTracks: () => undefined,
        onReorderAlbums: () => undefined,
        onSelectTracks: (selection) => {
          selectedTrackId = selection.selectedFileId;
        },
        onUploadToAlbum: () => undefined,
      },
      tree,
    });

    expect(movedTrackIds).toEqual(["track-a", "track-b"]);
    expect(selectedTrackId).toBe("track-a");
  });

  it("uses model-completed album drops to reorder relative to the target album", () => {
    const albums = [
      album("album-a", "Album A", []),
      album("album-b", "Album B", []),
      album("album-c", "Album C", []),
    ];
    const tree = buildLibraryTree({
      albums,
      files: [],
      looseTrackIds: [],
    });
    let reordered: { albumId: string; targetIndex: number } | null = null;

    handleLibraryTreeModelDrop({
      albums,
      event: {
        draggedPaths: [tree.pathByAlbumId.get("album-a") ?? ""],
        operation: "move",
        target: {
          directoryPath: tree.pathByAlbumId.get("album-b") ?? "",
          flattenedSegmentPath: null,
          hoveredPath: tree.pathByAlbumId.get("album-b") ?? "",
          kind: "directory",
        },
      },
      handlers: {
        onAudioUpload: () => undefined,
        onMoveTrackToAlbum: () => undefined,
        onMoveTrackToLoose: () => undefined,
        onPromptCreateAlbumFromLooseTracks: () => undefined,
        onReorderAlbums: (albumId, targetIndex) => {
          reordered = { albumId, targetIndex };
        },
        onSelectTracks: () => undefined,
        onUploadToAlbum: () => undefined,
      },
      placement: "before",
      tree,
    });

    expect(reordered).toEqual({ albumId: "album-a", targetIndex: 0 });
  });

  it("uses the hovered album track as the model-completed drop target", () => {
    const files = [file("track-a"), file("track-b"), file("track-c")];
    const albums = [
      album("source", "Source", ["track-a", "track-b"]),
      album("target", "Target", ["track-c"]),
    ];
    const tree = buildLibraryTree({
      albums,
      files,
      looseTrackIds: [],
    });
    const moves: { placement: string; referenceTrackId?: string; trackId: string }[] = [];

    handleLibraryTreeModelDrop({
      albums,
      event: {
        draggedPaths: [
          tree.pathByTrackId.get("track-a") ?? "",
          tree.pathByTrackId.get("track-b") ?? "",
        ],
        operation: "batch",
        target: {
          directoryPath: tree.pathByAlbumId.get("target") ?? "",
          flattenedSegmentPath: null,
          hoveredPath: tree.pathByTrackId.get("track-c") ?? "",
          kind: "directory",
        },
      },
      handlers: {
        onAudioUpload: () => undefined,
        onMoveTrackToAlbum: (trackId, _albumId, placement, referenceTrackId) => {
          moves.push({ placement, referenceTrackId, trackId });
        },
        onMoveTrackToLoose: () => undefined,
        onPromptCreateAlbumFromLooseTracks: () => undefined,
        onReorderAlbums: () => undefined,
        onSelectTracks: () => undefined,
        onUploadToAlbum: () => undefined,
      },
      placement: "before",
      tree,
    });

    expect(moves).toEqual([
      { placement: "before", referenceTrackId: "track-c", trackId: "track-a" },
      { placement: "before", referenceTrackId: "track-c", trackId: "track-b" },
    ]);
  });

  it("uses the hovered loose track as the model-completed root drop target", () => {
    const files = [file("track-a"), file("track-b"), file("track-c")];
    const albums = [album("source", "Source", ["track-a", "track-b"])];
    const tree = buildLibraryTree({
      albums,
      files,
      looseTrackIds: ["track-c"],
    });
    const moves: { placement: string; referenceTrackId?: string; trackId: string }[] = [];

    handleLibraryTreeModelDrop({
      albums,
      event: {
        draggedPaths: [
          tree.pathByTrackId.get("track-a") ?? "",
          tree.pathByTrackId.get("track-b") ?? "",
        ],
        operation: "batch",
        target: {
          directoryPath: null,
          flattenedSegmentPath: null,
          hoveredPath: tree.pathByTrackId.get("track-c") ?? "",
          kind: "root",
        },
      },
      handlers: {
        onAudioUpload: () => undefined,
        onMoveTrackToAlbum: () => undefined,
        onMoveTrackToLoose: (trackId, placement, referenceTrackId) => {
          moves.push({ placement, referenceTrackId, trackId });
        },
        onPromptCreateAlbumFromLooseTracks: () => undefined,
        onReorderAlbums: () => undefined,
        onSelectTracks: () => undefined,
        onUploadToAlbum: () => undefined,
      },
      placement: "before",
      tree,
    });

    expect(moves).toEqual([
      { placement: "before", referenceTrackId: "track-c", trackId: "track-a" },
      { placement: "before", referenceTrackId: "track-c", trackId: "track-b" },
    ]);
  });
});
