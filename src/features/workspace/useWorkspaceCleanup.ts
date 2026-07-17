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
  | { type: "album"; albumId: string }
  | { type: "tracks"; trackIds: ReadonlySet<string> };

export interface WorkspaceCleanup {
  dialogProps: MetadataCleanupDialogProps;
  albumIdsWithSuggestions: ReadonlySet<string>;
  onReviewAlbum: (albumId: string) => void;
}

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

  const albumIdsWithSuggestions = useMemo(() => {
    const albumIds = new Set<string>();
    const albumIdByTrackId = new Map(
      library.state.albums.flatMap((album) =>
        album.trackIds.map((trackId) => [trackId, album.id] as const),
      ),
    );
    availableSuggestions.forEach((suggestion) => {
      const albumId = albumIdByTrackId.get(suggestion.trackId);
      if (albumId) albumIds.add(albumId);
    });
    return albumIds;
  }, [availableSuggestions, library.state.albums]);

  const suggestions = useMemo(() => {
    if (!dialogScope) return [];
    if (dialogScope.type === "tracks") {
      return availableSuggestions.filter((suggestion) =>
        dialogScope.trackIds.has(suggestion.trackId),
      );
    }

    return findAlbumMetadataCleanupSuggestions(
      library.state.files,
      library.state.albums,
      dialogScope.albumId,
    );
  }, [availableSuggestions, dialogScope, library.state.albums, library.state.files]);

  const openDialog = useCallback((scope: CleanupDialogScope) => {
    setDialogScope(scope);
    setSelectionSessionKey((current) => current + 1);
    setOpen(true);
  }, []);

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
      const result = applyMetadataCleanupSuggestions(
        library.getSnapshot().files,
        selectedSuggestions,
        settingsRef.current.syncFilenames,
      );
      library.dispatch({ type: "content-replaced", files: result.files });
      setOpen(false);
      const selected = result.files.find(
        (file) => file.id === library.getSnapshot().selectedFileId,
      );
      if (selected?.metadata) editorRef.current.form.reset(selected.metadata);
      const noun = selectedSuggestions.length === 1 ? "track" : "tracks";
      toast.success(`cleaned up ${selectedSuggestions.length} ${noun}`, {
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
    [library],
  );

  const onReviewAlbum = useCallback(
    (albumId: string) => {
      openDialog({ type: "album", albumId });
    },
    [openDialog],
  );

  return {
    dialogProps: {
      open,
      selectionSessionKey,
      suggestions,
      onOpenChange: setOpen,
      onApply: apply,
    },
    albumIdsWithSuggestions,
    onReviewAlbum,
  };
};
