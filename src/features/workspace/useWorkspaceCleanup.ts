import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  applyMetadataCleanupSuggestions,
  findAlbumMetadataCleanupSuggestions,
  findMetadataCleanupSuggestions,
  undoMetadataCleanupSuggestions,
  type MetadataCleanupSuggestion,
} from "@/features/library/metadataCleanup";
import type { MetadataCleanupDialogProps } from "@/features/library/MetadataCleanupDialog";
import type { TrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AppSettings } from "@/features/library/types";

type CleanupEditor = { form: Pick<TrackEditorSession["form"], "reset"> };

type CleanupDialogScope =
  | { type: "album"; albumId: string; albumTitle: string }
  | { type: "tracks"; trackIds: ReadonlySet<string> };

export interface WorkspaceCleanup {
  dialogProps: MetadataCleanupDialogProps;
  cleanupSuggestionCountByAlbumId: ReadonlyMap<string, number>;
  onReviewAlbum: (albumId: string, returnFocusTarget: HTMLButtonElement | null) => void;
}

const suggestionsForScope = (
  files: LibraryStore["state"]["files"],
  albums: LibraryStore["state"]["albums"],
  scope: CleanupDialogScope | null,
) => {
  if (!scope) return [];
  if (scope.type === "album") {
    return findAlbumMetadataCleanupSuggestions(files, albums, scope.albumId);
  }
  return findMetadataCleanupSuggestions(files, albums, scope.trackIds);
};

export const useWorkspaceCleanup = ({
  library,
  editor,
  settings,
  busy,
}: {
  library: LibraryStore;
  editor: CleanupEditor;
  settings: AppSettings;
  busy: boolean;
}): WorkspaceCleanup => {
  const [dialogScope, setDialogScope] = useState<CleanupDialogScope | null>(null);
  const [selectionSessionKey, setSelectionSessionKey] = useState(0);
  const [returnFocusTarget, setReturnFocusTarget] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const offeredKeysRef = useRef(new Set<string>());
  const editorRef = useRef(editor);
  const settingsRef = useRef(settings);
  useLayoutEffect(() => {
    editorRef.current = editor;
    settingsRef.current = settings;
  }, [editor, settings]);

  const availableSuggestions = useMemo(
    () => findMetadataCleanupSuggestions(library.state.files, library.state.albums),
    [library.state.albums, library.state.files],
  );

  const cleanupSuggestionCountByAlbumId = useMemo(() => {
    const albumIdByTrackId = new Map(
      library.state.albums.flatMap((album) =>
        album.trackIds.map((trackId) => [trackId, album.id] as const),
      ),
    );
    const counts = new Map<string, number>();
    availableSuggestions.forEach((suggestion) => {
      const albumId = albumIdByTrackId.get(suggestion.trackId);
      if (albumId) counts.set(albumId, (counts.get(albumId) ?? 0) + 1);
    });
    return counts;
  }, [availableSuggestions, library.state.albums]);

  const suggestions = useMemo(
    () => suggestionsForScope(library.state.files, library.state.albums, dialogScope),
    [dialogScope, library.state.albums, library.state.files],
  );

  const openDialog = useCallback(
    (scope: CleanupDialogScope, focusTarget: HTMLButtonElement | null = null) => {
      setDialogScope(scope);
      setReturnFocusTarget(focusTarget);
      setSelectionSessionKey((current) => current + 1);
      setOpen(true);
    },
    [],
  );

  useEffect(() => {
    if (busy) return;
    const newSuggestions = availableSuggestions.filter((suggestion) => {
      const key = `${suggestion.trackId}:${suggestion.beforeTitle}:${suggestion.afterTitle}`;
      if (offeredKeysRef.current.has(key)) return false;
      offeredKeysRef.current.add(key);
      return true;
    });
    if (newSuggestions.length === 0) return;
    const noun = newSuggestions.length === 1 ? "track" : "tracks";
    toast(`we found ${newSuggestions.length} ${noun} that could be cleaned up`, {
      description: `${newSuggestions[0].beforeTitle} → ${newSuggestions[0].afterTitle}`,
      action: {
        label: "review",
        onClick: () => {
          openDialog({
            type: "tracks",
            trackIds: new Set(newSuggestions.map(({ trackId }) => trackId)),
          });
        },
      },
    });
  }, [availableSuggestions, busy, openDialog]);

  const apply = useCallback(
    (selectedSuggestions: MetadataCleanupSuggestion[]) => {
      const snapshot = library.getSnapshot();
      const selectedTrackIds = new Set(selectedSuggestions.map((suggestion) => suggestion.trackId));
      const currentSelectedSuggestions = suggestionsForScope(
        snapshot.files,
        snapshot.albums,
        dialogScope,
      ).filter((suggestion) => selectedTrackIds.has(suggestion.trackId));

      if (currentSelectedSuggestions.length === 0) {
        setOpen(false);
        return;
      }

      const result = applyMetadataCleanupSuggestions(
        snapshot.files,
        currentSelectedSuggestions,
        settingsRef.current.syncFilenames,
      );
      library.dispatch({ type: "content-replaced", files: result.files });
      setOpen(false);
      const selected = result.files.find(
        (file) => file.id === library.getSnapshot().selectedFileId,
      );
      if (selected?.metadata) editorRef.current.form.reset(selected.metadata);
      const noun = currentSelectedSuggestions.length === 1 ? "track" : "tracks";
      toast.success(`cleaned up ${currentSelectedSuggestions.length} ${noun}`, {
        description: settingsRef.current.syncFilenames
          ? "titles and synced filenames were updated"
          : "titles were updated",
        action: {
          label: "undo",
          onClick: () => {
            const restoredFiles = undoMetadataCleanupSuggestions(
              library.getSnapshot().files,
              result.undoEntries,
            );
            library.dispatch({ type: "content-replaced", files: restoredFiles });
            const restored = restoredFiles.find(
              (file) => file.id === library.getSnapshot().selectedFileId,
            );
            if (restored?.metadata) editorRef.current.form.reset(restored.metadata);
          },
        },
      });
    },
    [dialogScope, library],
  );

  const onReviewAlbum = useCallback(
    (albumId: string, focusTarget: HTMLButtonElement | null) => {
      const album = library.getSnapshot().albums.find((candidate) => candidate.id === albumId);
      if (!album) return;
      openDialog({ type: "album", albumId, albumTitle: album.title }, focusTarget);
    },
    [library, openDialog],
  );

  return {
    dialogProps: {
      open,
      selectionSessionKey,
      suggestions,
      albumTitle: dialogScope?.type === "album" ? dialogScope.albumTitle : undefined,
      returnFocusTarget,
      onOpenChange: setOpen,
      onApply: apply,
    },
    cleanupSuggestionCountByAlbumId,
    onReviewAlbum,
  };
};
