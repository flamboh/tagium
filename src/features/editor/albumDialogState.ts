import type { SetStateAction } from "react";
import type { AlbumMetadataDraft } from "@/features/editor/AlbumMetadataDialog";
import { toGenreString } from "@/features/audio/mp3Utils";
import type { AlbumGroup, TagiumFile } from "@/features/library/types";

export type AlbumDialogMode = "create" | "edit";

export interface AlbumDialogState {
  open: boolean;
  mode: AlbumDialogMode;
  draft: AlbumMetadataDraft;
  placeholderSeed: string;
  editingAlbumId: string | null;
  createSeedTrackIds: string[];
}

export type AlbumDialogAction =
  | {
      type: "create-opened";
      seedTrackIds: string[];
      seedTrack?: TagiumFile;
      placeholderSeed: string;
    }
  | { type: "edit-opened"; album: AlbumGroup }
  | { type: "draft-changed"; update: SetStateAction<AlbumMetadataDraft> }
  | { type: "closed" | "saved" | "deleted" };

export type AlbumDialogSubmission =
  | {
      mode: "create";
      seedTrackIds: string[];
      metadata: Omit<AlbumGroup, "id" | "trackIds">;
    }
  | {
      mode: "edit";
      albumId: string;
      metadata: Omit<AlbumGroup, "id" | "trackIds">;
    };

const emptyDraft = (): AlbumMetadataDraft => ({
  title: "",
  artist: "",
  genre: "",
  year: undefined,
  cover: undefined,
});

export const createAlbumDialogState = (): AlbumDialogState => ({
  open: false,
  mode: "create",
  draft: emptyDraft(),
  placeholderSeed: "new-album",
  editingAlbumId: null,
  createSeedTrackIds: [],
});

export const createOpenAlbumDialogAction = (
  seedTrackIds: string[],
  files: TagiumFile[],
  fallbackPlaceholderSeed: string,
): AlbumDialogAction => {
  const uniqueSeedTrackIds = [...new Set(seedTrackIds)];
  const seedTrack = files.find((file) => file.id === uniqueSeedTrackIds[0]);
  return {
    type: "create-opened",
    seedTrackIds: uniqueSeedTrackIds,
    seedTrack,
    placeholderSeed: uniqueSeedTrackIds[0] ?? fallbackPlaceholderSeed,
  };
};

export const albumDialogReducer = (
  state: AlbumDialogState,
  action: AlbumDialogAction,
): AlbumDialogState => {
  switch (action.type) {
    case "create-opened": {
      const hasSeeds = action.seedTrackIds.length > 0;
      const metadata = action.seedTrack?.metadata;
      return {
        open: true,
        mode: "create",
        draft: {
          title: "",
          artist: hasSeeds ? metadata?.artist || "" : "",
          genre: hasSeeds ? toGenreString(metadata?.genre) : "",
          cover: hasSeeds && metadata?.picture?.length ? metadata.picture : undefined,
          year: hasSeeds ? (metadata?.year ?? undefined) : undefined,
        },
        placeholderSeed: action.placeholderSeed,
        editingAlbumId: null,
        createSeedTrackIds: action.seedTrackIds,
      };
    }
    case "edit-opened":
      return {
        open: true,
        mode: "edit",
        draft: {
          title: action.album.title,
          artist: action.album.artist,
          genre: action.album.genre,
          cover: action.album.cover,
          year: action.album.year,
        },
        placeholderSeed: action.album.id,
        editingAlbumId: action.album.id,
        createSeedTrackIds: [],
      };
    case "draft-changed":
      return {
        ...state,
        draft: typeof action.update === "function" ? action.update(state.draft) : action.update,
      };
    case "closed":
    case "saved":
    case "deleted":
      return { ...state, open: false };
  }
};

export const getAlbumDialogSubmission = (state: AlbumDialogState): AlbumDialogSubmission | null => {
  if (!state.open) return null;

  const metadata = {
    title: state.draft.title.trim() || "untitled album",
    artist: state.draft.artist.trim(),
    genre: state.draft.genre.trim(),
    cover: state.draft.cover,
    year: state.draft.year,
  };
  if (state.mode === "edit") {
    return state.editingAlbumId ? { mode: "edit", albumId: state.editingAlbumId, metadata } : null;
  }
  return { mode: "create", seedTrackIds: state.createSeedTrackIds, metadata };
};
