export interface TrackSelection {
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
  lastSelectedFileId: string | null;
}

export interface SelectionMode {
  multi?: boolean;
  range?: boolean;
}

const toggleFileId = (selectedFileIds: Set<string>, fileId: string) => {
  const next = new Set(selectedFileIds);
  if (next.has(fileId)) {
    next.delete(fileId);
  } else {
    next.add(fileId);
  }
  return next;
};

const addRange = (
  selectedFileIds: Set<string>,
  orderedFileIds: string[],
  startFileId: string | null,
  endFileId: string,
) => {
  if (!startFileId) return null;

  const startIndex = orderedFileIds.indexOf(startFileId);
  const endIndex = orderedFileIds.indexOf(endFileId);
  if (startIndex < 0 || endIndex < 0) return null;

  const minIndex = Math.min(startIndex, endIndex);
  const maxIndex = Math.max(startIndex, endIndex);
  const next = new Set(selectedFileIds);
  orderedFileIds.slice(minIndex, maxIndex + 1).forEach((id) => next.add(id));
  return next;
};

export const selectAlbum = (
  current: TrackSelection,
  albumId: string,
  albumTrackIds: string[],
  mode: SelectionMode = {},
): TrackSelection => {
  const firstTrackId = albumTrackIds[0] ?? null;

  if (mode.multi) {
    if (!firstTrackId) {
      return {
        ...current,
        selectedAlbumId: albumId,
      };
    }

    return {
      selectedAlbumId: albumId,
      selectedFileId: firstTrackId,
      selectedFileIds: toggleFileId(current.selectedFileIds, firstTrackId),
      lastSelectedFileId: firstTrackId,
    };
  }

  return {
    selectedAlbumId: albumId,
    selectedFileId: firstTrackId,
    selectedFileIds: firstTrackId ? new Set([firstTrackId]) : new Set(),
    lastSelectedFileId: firstTrackId,
  };
};

export const selectAlbumTrack = (
  current: TrackSelection,
  albumId: string,
  fileId: string,
  albumTrackIds: string[],
  mode: SelectionMode = {},
): TrackSelection => {
  if (mode.range) {
    const selectedFileIds = addRange(
      current.selectedFileIds,
      albumTrackIds,
      current.lastSelectedFileId,
      fileId,
    );
    if (selectedFileIds) {
      return {
        ...current,
        selectedFileId: fileId,
        selectedFileIds,
        lastSelectedFileId: fileId,
      };
    }
    return current;
  }

  if (mode.multi) {
    return {
      selectedAlbumId: albumId,
      selectedFileId: fileId,
      selectedFileIds: toggleFileId(current.selectedFileIds, fileId),
      lastSelectedFileId: fileId,
    };
  }

  return {
    selectedAlbumId: albumId,
    selectedFileId: fileId,
    selectedFileIds: new Set([fileId]),
    lastSelectedFileId: fileId,
  };
};

export const selectLooseTrack = (
  current: TrackSelection,
  fileId: string,
  looseTrackIds: string[],
  mode: SelectionMode = {},
): TrackSelection => {
  if (mode.range) {
    const selectedFileIds = addRange(
      current.selectedFileIds,
      looseTrackIds,
      current.lastSelectedFileId,
      fileId,
    );
    if (selectedFileIds) {
      return {
        ...current,
        selectedFileId: fileId,
        selectedFileIds,
        lastSelectedFileId: fileId,
      };
    }
    return current;
  }

  if (mode.multi) {
    return {
      selectedAlbumId: null,
      selectedFileId: fileId,
      selectedFileIds: toggleFileId(current.selectedFileIds, fileId),
      lastSelectedFileId: fileId,
    };
  }

  return {
    selectedAlbumId: null,
    selectedFileId: fileId,
    selectedFileIds: new Set([fileId]),
    lastSelectedFileId: fileId,
  };
};

export const clearSelection = (): TrackSelection => ({
  selectedAlbumId: null,
  selectedFileId: null,
  selectedFileIds: new Set(),
  lastSelectedFileId: null,
});

export const selectAllFiles = (
  current: TrackSelection,
  visibleFileIds: string[],
): TrackSelection => {
  const firstFileId = visibleFileIds[0];
  if (!firstFileId) {
    return {
      ...current,
      selectedFileId: null,
      selectedFileIds: new Set(),
      lastSelectedFileId: null,
    };
  }

  return {
    ...current,
    selectedFileId: firstFileId,
    selectedFileIds: new Set(visibleFileIds),
    lastSelectedFileId: firstFileId,
  };
};
