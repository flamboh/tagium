import type { FileTreeDropContext, FileTreeDropResult } from "@pierre/trees";
import type { DragEvent } from "react";
import type { LibraryTreeEntry, LibraryTreeModel } from "./libraryTree";
import type { AlbumGroup } from "./types";

type LibraryTreeDropPlacement = "before" | "after";

export interface LibraryTreeDropHandlers {
  onAudioUpload: (files: File[]) => void;
  onMoveTrackToAlbum: (
    trackId: string,
    targetAlbumId: string,
    placement: "before" | "after" | "append",
    referenceTrackId?: string,
  ) => void;
  onMoveTrackToLoose: (
    trackId: string,
    placement: "before" | "after" | "append",
    referenceTrackId?: string,
  ) => void;
  onPromptCreateAlbumFromLooseTracks: (sourceTrackId: string, targetTrackId: string) => void;
  onReorderAlbums: (albumId: string, targetIndex: number) => void;
  onSelectTracks: (selection: {
    selectedAlbumId: string | null;
    selectedFileId: string | null;
    selectedFileIds: string[];
  }) => void;
  onUploadToAlbum: (albumId: string, files: File[]) => void;
}

export const getTreeRowElement = (event: DragEvent<HTMLElement>) =>
  event.nativeEvent
    .composedPath()
    .find(
      (target): target is HTMLElement =>
        Boolean(target) &&
        typeof target === "object" &&
        "dataset" in target &&
        (target as HTMLElement).dataset.type === "item",
    ) ?? null;

const getTreeEventPath = (event: DragEvent<HTMLElement>) =>
  getTreeRowElement(event)?.dataset.itemPath ?? null;

const placementForDrop = (event: DragEvent<HTMLElement>) => {
  const row = getTreeRowElement(event);
  if (!row) return "append";
  const rect = row.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
};

const isCenteredDrop = (event: DragEvent<HTMLElement>) => {
  const row = getTreeRowElement(event);
  if (!row) return false;
  const rect = row.getBoundingClientRect();
  const position = (event.clientY - rect.top) / rect.height;
  return position > 0.3 && position < 0.7;
};

export function getLibraryTreeModelDropTargetEntry(
  event: FileTreeDropContext,
  tree: LibraryTreeModel,
) {
  let targetEntry: LibraryTreeEntry | undefined;
  if (event.target.hoveredPath) {
    targetEntry = tree.entriesByPath.get(event.target.hoveredPath);
  }
  if (!targetEntry && event.target.directoryPath) {
    targetEntry = tree.entriesByPath.get(event.target.directoryPath);
  }
  return targetEntry;
}

export function getLibraryTreeModelDropPlacement({
  event,
  pointerY,
  treeElement,
}: {
  event: FileTreeDropResult;
  pointerY: number | null;
  treeElement: HTMLElement | null;
}): LibraryTreeDropPlacement {
  if (pointerY === null || !event.target.hoveredPath || !treeElement) return "after";
  const host = treeElement.querySelector("file-tree-container");
  if (!host?.shadowRoot) return "after";

  const rows = host.shadowRoot.querySelectorAll<HTMLElement>("[data-type='item']");
  for (const row of rows) {
    if (row.dataset.itemPath !== event.target.hoveredPath) continue;
    const rect = row.getBoundingClientRect();
    if (pointerY > rect.top + rect.height / 2) return "after";
    return "before";
  }
  return "after";
}

const targetIndexForAlbumDrop = (
  albums: AlbumGroup[],
  sourceAlbumId: string,
  targetAlbumId: string,
  placement: "before" | "after" | "append",
) => {
  if (sourceAlbumId === targetAlbumId) return null;
  const sourceIndex = albums.findIndex((album) => album.id === sourceAlbumId);
  const targetIndex = albums.findIndex((album) => album.id === targetAlbumId);
  if (sourceIndex < 0 || targetIndex < 0) return null;
  const placedIndex = placement === "after" ? targetIndex + 1 : targetIndex;
  if (sourceIndex < placedIndex) return placedIndex - 1;
  return placedIndex;
};

const getDraggedTrackEntries = (
  draggedEntry: Extract<LibraryTreeEntry, { type: "track" }>,
  draggedPath: string,
  selectedPaths: string[],
  tree: LibraryTreeModel,
) => {
  const selectedPathSet = new Set(selectedPaths);
  if (!selectedPathSet.has(draggedPath)) return [draggedEntry];

  return selectedPaths
    .map((selectedPath) => tree.entriesByPath.get(selectedPath))
    .filter(
      (entry): entry is Extract<LibraryTreeEntry, { type: "track" }> => entry?.type === "track",
    );
};

const selectMovedTracks = (
  handlers: LibraryTreeDropHandlers,
  draggedEntry: Extract<LibraryTreeEntry, { type: "track" }>,
  draggedEntries: Extract<LibraryTreeEntry, { type: "track" }>[],
  selectedAlbumId: string | null,
) => {
  handlers.onSelectTracks({
    selectedAlbumId,
    selectedFileId: draggedEntry.trackId,
    selectedFileIds: draggedEntries.map((entry) => entry.trackId),
  });
};

export function handleLibraryTreeDrop({
  albums,
  event,
  handlers,
  selectedPaths,
  tree,
}: {
  albums: AlbumGroup[];
  event: DragEvent<HTMLElement>;
  handlers: LibraryTreeDropHandlers;
  selectedPaths: string[];
  tree: LibraryTreeModel;
}) {
  const droppedFiles = Array.from(event.dataTransfer.files);
  if (droppedFiles.length > 0) {
    const audioFiles = droppedFiles.filter((file) => file.type.startsWith("audio/"));
    if (audioFiles.length === 0) return;
    const targetPath = getTreeEventPath(event);
    const targetEntry = targetPath ? tree.entriesByPath.get(targetPath) : null;
    const albumId =
      targetEntry?.type === "album"
        ? targetEntry.albumId
        : targetEntry?.type === "track"
          ? targetEntry.albumId
          : null;
    event.preventDefault();
    event.stopPropagation();
    if (albumId) {
      handlers.onUploadToAlbum(albumId, audioFiles);
      return;
    }
    handlers.onAudioUpload(audioFiles);
    return;
  }

  const draggedPath = event.dataTransfer.getData("text/plain");
  const draggedEntry = tree.entriesByPath.get(draggedPath);
  const targetPath = getTreeEventPath(event);
  const targetEntry = targetPath ? tree.entriesByPath.get(targetPath) : null;
  if (!draggedEntry) return;

  event.preventDefault();
  event.stopPropagation();
  if (!targetEntry) {
    if (draggedEntry.type !== "track") return;
    const draggedEntries = getDraggedTrackEntries(draggedEntry, draggedPath, selectedPaths, tree);
    for (const entry of draggedEntries) {
      handlers.onMoveTrackToLoose(entry.trackId, "append");
    }
    selectMovedTracks(handlers, draggedEntry, draggedEntries, null);
    return;
  }
  if (draggedEntry.type === "album" && targetEntry.type === "album") {
    const targetIndex = targetIndexForAlbumDrop(
      albums,
      draggedEntry.albumId,
      targetEntry.albumId,
      placementForDrop(event),
    );
    if (targetIndex === null) return;
    handlers.onReorderAlbums(draggedEntry.albumId, targetIndex);
    return;
  }

  if (draggedEntry.type !== "track") return;
  const draggedEntries = getDraggedTrackEntries(draggedEntry, draggedPath, selectedPaths, tree);
  if (
    targetEntry.type === "track" &&
    draggedEntries.some((entry) => entry.trackId === targetEntry.trackId)
  ) {
    return;
  }
  if (targetEntry.type === "album") {
    for (const entry of draggedEntries) {
      handlers.onMoveTrackToAlbum(entry.trackId, targetEntry.albumId, "append");
    }
    selectMovedTracks(handlers, draggedEntry, draggedEntries, targetEntry.albumId);
    return;
  }
  if (targetEntry.type === "track" && targetEntry.albumId) {
    const placement = placementForDrop(event);
    const orderedEntries = placement === "after" ? [...draggedEntries].reverse() : draggedEntries;
    for (const entry of orderedEntries) {
      handlers.onMoveTrackToAlbum(
        entry.trackId,
        targetEntry.albumId,
        placement,
        targetEntry.trackId,
      );
    }
    selectMovedTracks(handlers, draggedEntry, draggedEntries, targetEntry.albumId);
    return;
  }
  if (targetEntry.type === "track" && !targetEntry.albumId) {
    if (draggedEntries.length === 1 && !draggedEntry.albumId && isCenteredDrop(event)) {
      handlers.onPromptCreateAlbumFromLooseTracks(draggedEntry.trackId, targetEntry.trackId);
      return;
    }
    const placement = placementForDrop(event);
    const orderedEntries = placement === "after" ? [...draggedEntries].reverse() : draggedEntries;
    for (const entry of orderedEntries) {
      handlers.onMoveTrackToLoose(entry.trackId, placement, targetEntry.trackId);
    }
    selectMovedTracks(handlers, draggedEntry, draggedEntries, null);
  }
}

export function handleLibraryTreeModelDrop({
  albums,
  event,
  handlers,
  placement = "after",
  tree,
}: {
  albums: AlbumGroup[];
  event: FileTreeDropResult;
  handlers: LibraryTreeDropHandlers;
  placement?: LibraryTreeDropPlacement;
  tree: LibraryTreeModel;
}) {
  const draggedEntries = event.draggedPaths
    .map((draggedPath) => tree.entriesByPath.get(draggedPath))
    .filter((entry): entry is LibraryTreeEntry => Boolean(entry));
  const [draggedEntry] = draggedEntries;
  const targetEntry = getLibraryTreeModelDropTargetEntry(event, tree);

  if (!draggedEntry) return;
  if (draggedEntry.type === "album") {
    if (targetEntry?.type !== "album") return;
    const targetIndex = targetIndexForAlbumDrop(
      albums,
      draggedEntry.albumId,
      targetEntry.albumId,
      placement,
    );
    if (targetIndex === null) return;
    handlers.onReorderAlbums(draggedEntry.albumId, targetIndex);
    return;
  }

  const draggedTrackEntries = draggedEntries.filter(
    (entry): entry is Extract<LibraryTreeEntry, { type: "track" }> => entry.type === "track",
  );
  if (draggedTrackEntries.length === 0) return;

  if (targetEntry?.type === "album") {
    for (const entry of draggedTrackEntries) {
      handlers.onMoveTrackToAlbum(entry.trackId, targetEntry.albumId, "append");
    }
    selectMovedTracks(handlers, draggedEntry, draggedTrackEntries, targetEntry.albumId);
    return;
  }

  if (targetEntry?.type === "track" && targetEntry.albumId) {
    if (draggedTrackEntries.some((entry) => entry.trackId === targetEntry.trackId)) return;
    const orderedEntries =
      placement === "after" ? [...draggedTrackEntries].reverse() : draggedTrackEntries;
    for (const entry of orderedEntries) {
      handlers.onMoveTrackToAlbum(
        entry.trackId,
        targetEntry.albumId,
        placement,
        targetEntry.trackId,
      );
    }
    selectMovedTracks(handlers, draggedEntry, draggedTrackEntries, targetEntry.albumId);
    return;
  }

  if (targetEntry?.type === "track" && !targetEntry.albumId) {
    if (draggedTrackEntries.some((entry) => entry.trackId === targetEntry.trackId)) return;
    const orderedEntries =
      placement === "after" ? [...draggedTrackEntries].reverse() : draggedTrackEntries;
    for (const entry of orderedEntries) {
      handlers.onMoveTrackToLoose(entry.trackId, placement, targetEntry.trackId);
    }
    selectMovedTracks(handlers, draggedEntry, draggedTrackEntries, null);
    return;
  }

  for (const entry of draggedTrackEntries) {
    handlers.onMoveTrackToLoose(entry.trackId, "append");
  }
  selectMovedTracks(handlers, draggedEntry, draggedTrackEntries, null);
}
