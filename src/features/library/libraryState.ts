import type { AlbumGroup, TagiumFile } from "@/features/library/types";

export type TrackSelectionMode = "replace" | "toggle" | "range";

export interface LibraryState {
  files: TagiumFile[];
  albums: AlbumGroup[];
  looseTrackIds: string[];
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
  rangeAnchorFileId: string | null;
  selectionWasManuallyCleared: boolean;
}

export interface LibrarySelection {
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds?: ReadonlySet<string>;
  rangeAnchorFileId?: string | null;
}

export type LibraryAction =
  | {
      type: "content-replaced";
      files?: TagiumFile[];
      albums?: AlbumGroup[];
      looseTrackIds?: string[];
      selection?: LibrarySelection;
    }
  | {
      type: "tracks-removed";
      trackIds: string[];
      files?: TagiumFile[];
      albums?: AlbumGroup[];
    }
  | { type: "album-removed"; albumId: string }
  | { type: "album-selected"; albumId: string; mode: Exclude<TrackSelectionMode, "range"> }
  | {
      type: "track-selected";
      albumId: string | null;
      fileId: string;
      mode: TrackSelectionMode;
    }
  | { type: "selection-cleared" }
  | { type: "all-tracks-selected" };

const uniqueExistingTrackIds = (trackIds: Iterable<string>, fileIdSet: ReadonlySet<string>) => {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const trackId of trackIds) {
    if (!fileIdSet.has(trackId) || seen.has(trackId)) continue;
    seen.add(trackId);
    result.push(trackId);
  }
  return result;
};

const uniqueById = <Value extends { id: string }>(values: Value[]) => {
  const result: Value[] = [];
  const indexById = new Map<string, number>();
  for (const value of values) {
    const existingIndex = indexById.get(value.id);
    if (existingIndex === undefined) {
      indexById.set(value.id, result.length);
      result.push(value);
    } else {
      result[existingIndex] = value;
    }
  }
  return result;
};

const getTrackAlbumId = (albums: AlbumGroup[], trackId: string) =>
  albums.find((album) => album.trackIds.includes(trackId))?.id ?? null;

const getOrderedFileIds = (state: LibraryState) => {
  const fileIdSet = new Set(state.files.map((file) => file.id));
  const orderedIds = uniqueExistingTrackIds(
    [
      ...state.looseTrackIds,
      ...state.albums.flatMap((album) => album.trackIds),
      ...state.files.map((file) => file.id),
    ],
    fileIdSet,
  );
  return orderedIds;
};

const withClearedSelection = (state: LibraryState, manuallyCleared: boolean): LibraryState => ({
  ...state,
  selectedAlbumId: null,
  selectedFileId: null,
  selectedFileIds: new Set(),
  rangeAnchorFileId: null,
  selectionWasManuallyCleared: manuallyCleared,
});

const normalizeSelection = (state: LibraryState): LibraryState => {
  const fileIdSet = new Set(state.files.map((file) => file.id));
  const albumIdSet = new Set(state.albums.map((album) => album.id));
  const selectedFileIds = new Set(uniqueExistingTrackIds(state.selectedFileIds, fileIdSet));
  const rangeAnchorFileId =
    state.rangeAnchorFileId && fileIdSet.has(state.rangeAnchorFileId)
      ? state.rangeAnchorFileId
      : null;

  if (state.selectionWasManuallyCleared) {
    return withClearedSelection(state, true);
  }

  const selectedAlbumId =
    state.selectedAlbumId && albumIdSet.has(state.selectedAlbumId) ? state.selectedAlbumId : null;
  if (state.selectedFileId && fileIdSet.has(state.selectedFileId)) {
    return {
      ...state,
      selectedAlbumId: getTrackAlbumId(state.albums, state.selectedFileId),
      selectedFileIds,
      rangeAnchorFileId,
    };
  }

  const firstRemainingSelectedId = getOrderedFileIds(state).find((trackId) =>
    selectedFileIds.has(trackId),
  );
  if (firstRemainingSelectedId) {
    return {
      ...state,
      selectedAlbumId: getTrackAlbumId(state.albums, firstRemainingSelectedId),
      selectedFileId: firstRemainingSelectedId,
      selectedFileIds,
      rangeAnchorFileId: rangeAnchorFileId ?? firstRemainingSelectedId,
    };
  }

  if (selectedAlbumId) {
    const selectedAlbum = state.albums.find((album) => album.id === selectedAlbumId);
    const firstAlbumTrackId = selectedAlbum?.trackIds.find((trackId) => fileIdSet.has(trackId));
    if (!firstAlbumTrackId) {
      return {
        ...state,
        selectedAlbumId,
        selectedFileId: null,
        selectedFileIds,
        rangeAnchorFileId: null,
      };
    }
    return {
      ...state,
      selectedAlbumId,
      selectedFileId: firstAlbumTrackId,
      selectedFileIds: new Set([firstAlbumTrackId]),
      rangeAnchorFileId: firstAlbumTrackId,
    };
  }

  const firstLooseTrackId = state.looseTrackIds.find((trackId) => fileIdSet.has(trackId));
  if (firstLooseTrackId) {
    return {
      ...state,
      selectedAlbumId: null,
      selectedFileId: firstLooseTrackId,
      selectedFileIds: new Set([firstLooseTrackId]),
      rangeAnchorFileId: firstLooseTrackId,
    };
  }

  for (const album of state.albums) {
    const firstAlbumTrackId = album.trackIds.find((trackId) => fileIdSet.has(trackId));
    if (!firstAlbumTrackId) continue;
    return {
      ...state,
      selectedAlbumId: album.id,
      selectedFileId: firstAlbumTrackId,
      selectedFileIds: new Set([firstAlbumTrackId]),
      rangeAnchorFileId: firstAlbumTrackId,
    };
  }

  const firstFileId = state.files[0]?.id;
  if (firstFileId) {
    return {
      ...state,
      selectedAlbumId: null,
      selectedFileId: firstFileId,
      selectedFileIds: new Set([firstFileId]),
      rangeAnchorFileId: firstFileId,
    };
  }

  return withClearedSelection(state, false);
};

const normalizeContents = (state: LibraryState) => {
  const files = uniqueById(state.files);
  const fileIdSet = new Set(files.map((file) => file.id));
  const assignedTrackIds = new Set<string>();
  const albums = uniqueById(state.albums).map((album) => {
    const trackIds = uniqueExistingTrackIds(album.trackIds, fileIdSet).filter((trackId) => {
      if (assignedTrackIds.has(trackId)) return false;
      assignedTrackIds.add(trackId);
      return true;
    });
    return { ...album, trackIds };
  });
  const nextState = {
    ...state,
    files,
    albums,
    looseTrackIds: uniqueExistingTrackIds(state.looseTrackIds, fileIdSet).filter(
      (trackId) => !assignedTrackIds.has(trackId),
    ),
  };
  return normalizeSelection(nextState);
};

export const createLibraryState = (): LibraryState => ({
  files: [],
  albums: [],
  looseTrackIds: [],
  selectedAlbumId: null,
  selectedFileId: null,
  selectedFileIds: new Set(),
  rangeAnchorFileId: null,
  selectionWasManuallyCleared: true,
});

const applySelection = (state: LibraryState, selection: LibrarySelection): LibraryState =>
  normalizeSelection({
    ...state,
    selectedAlbumId: selection.selectedAlbumId,
    selectedFileId: selection.selectedFileId,
    selectedFileIds: new Set(
      selection.selectedFileIds ?? (selection.selectedFileId ? [selection.selectedFileId] : []),
    ),
    rangeAnchorFileId:
      selection.rangeAnchorFileId === undefined
        ? selection.selectedFileId
        : selection.rangeAnchorFileId,
    selectionWasManuallyCleared: false,
  });

const getSelectionScope = (state: LibraryState, albumId: string | null) =>
  albumId === null
    ? state.looseTrackIds
    : (state.albums.find((album) => album.id === albumId)?.trackIds ?? []);

const selectTrack = (
  state: LibraryState,
  albumId: string | null,
  fileId: string,
  mode: TrackSelectionMode,
) => {
  if (!state.files.some((file) => file.id === fileId)) return state;
  if (mode === "replace") {
    return applySelection(state, {
      selectedAlbumId: albumId,
      selectedFileId: fileId,
      selectedFileIds: new Set([fileId]),
      rangeAnchorFileId: fileId,
    });
  }

  const selectedFileIds = new Set(state.selectedFileIds);
  if (mode === "toggle") {
    if (selectedFileIds.has(fileId)) selectedFileIds.delete(fileId);
    else selectedFileIds.add(fileId);
  } else {
    const scope = getSelectionScope(state, albumId);
    const startIndex = state.rangeAnchorFileId ? scope.indexOf(state.rangeAnchorFileId) : -1;
    const endIndex = scope.indexOf(fileId);
    if (startIndex < 0 || endIndex < 0) {
      return state;
    } else {
      const [start, end] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
      for (const trackId of scope.slice(start, end + 1)) selectedFileIds.add(trackId);
    }
  }

  return applySelection(state, {
    selectedAlbumId: albumId,
    selectedFileId: fileId,
    selectedFileIds,
    rangeAnchorFileId: fileId,
  });
};

export const libraryReducer = (state: LibraryState, action: LibraryAction): LibraryState => {
  switch (action.type) {
    case "content-replaced": {
      const content = normalizeContents({
        ...state,
        files: action.files ?? state.files,
        albums: action.albums ?? state.albums,
        looseTrackIds: action.looseTrackIds ?? state.looseTrackIds,
      });
      return action.selection ? applySelection(content, action.selection) : content;
    }
    case "tracks-removed": {
      const trackIdSet = new Set(action.trackIds);
      const files = action.files ?? state.files.filter((file) => !trackIdSet.has(file.id));
      const albums =
        action.albums ??
        state.albums.map((album) => ({
          ...album,
          trackIds: album.trackIds.filter((trackId) => !trackIdSet.has(trackId)),
        }));
      return normalizeContents({
        ...state,
        files,
        albums,
        looseTrackIds: state.looseTrackIds.filter((trackId) => !trackIdSet.has(trackId)),
      });
    }
    case "album-removed": {
      const removedAlbum = state.albums.find((album) => album.id === action.albumId);
      if (!removedAlbum) return state;
      const trackIdSet = new Set(removedAlbum.trackIds);
      return normalizeContents({
        ...state,
        files: state.files.filter((file) => !trackIdSet.has(file.id)),
        albums: state.albums.filter((album) => album.id !== action.albumId),
        looseTrackIds: state.looseTrackIds.filter((trackId) => !trackIdSet.has(trackId)),
      });
    }
    case "album-selected": {
      const album = state.albums.find((entry) => entry.id === action.albumId);
      if (!album) return state;
      const firstTrackId = album.trackIds.find((trackId) =>
        state.files.some((file) => file.id === trackId),
      );
      if (!firstTrackId) {
        return applySelection(state, {
          selectedAlbumId: album.id,
          selectedFileId: null,
          selectedFileIds: new Set(),
          rangeAnchorFileId: null,
        });
      }
      return selectTrack(state, album.id, firstTrackId, action.mode);
    }
    case "track-selected":
      return selectTrack(state, action.albumId, action.fileId, action.mode);
    case "selection-cleared":
      return withClearedSelection(state, true);
    case "all-tracks-selected": {
      const firstFileId = state.files[0]?.id ?? null;
      if (!firstFileId) return withClearedSelection(state, false);
      return {
        ...state,
        selectedAlbumId: getTrackAlbumId(state.albums, firstFileId),
        selectedFileId: firstFileId,
        selectedFileIds: new Set(state.files.map((file) => file.id)),
        rangeAnchorFileId: firstFileId,
        selectionWasManuallyCleared: false,
      };
    }
  }
};
