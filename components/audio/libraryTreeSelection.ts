import type { LibraryTreeEntry } from "./libraryTree";

export interface LibraryTreeSelection {
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: string[];
}

export const resolveSelection = (
  selectedPaths: readonly string[],
  entriesByPath: Map<string, LibraryTreeEntry>,
): LibraryTreeSelection => {
  let selectedAlbumId: string | null = null;
  let selectedFileId: string | null = null;
  const selectedFileIds = new Set<string>();

  for (const path of selectedPaths) {
    const entry = entriesByPath.get(path);
    if (!entry) continue;

    if (entry.type === "album") {
      selectedAlbumId = entry.albumId;
      const [firstTrackId] = entry.trackIds;
      if (firstTrackId) {
        selectedFileIds.add(firstTrackId);
        selectedFileId = firstTrackId;
      }
    }

    if (entry.type === "track") {
      selectedAlbumId = entry.albumId;
      selectedFileIds.add(entry.trackId);
      selectedFileId = entry.trackId;
    }
  }

  return {
    selectedAlbumId,
    selectedFileId,
    selectedFileIds: [...selectedFileIds],
  };
};

export const getNativeTreePath = (event: Event) =>
  event
    .composedPath()
    .find(
      (target): target is HTMLElement =>
        Boolean(target) &&
        typeof target === "object" &&
        "dataset" in target &&
        (target as HTMLElement).dataset.type === "item",
    )?.dataset.itemPath ?? null;

export const isTreeOwnedClick = (event: Event) =>
  event
    .composedPath()
    .some(
      (target) =>
        Boolean(target) &&
        typeof target === "object" &&
        "dataset" in target &&
        ((target as HTMLElement).dataset.type === "item" ||
          (target as HTMLElement).dataset.type === "context-menu-trigger" ||
          (target as HTMLElement).dataset.type === "context-menu-anchor"),
    );
