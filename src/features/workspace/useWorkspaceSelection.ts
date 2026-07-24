import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { analytics } from "@/analytics";
import {
  moveTrackInSidebar,
  removeTrackFromAlbums,
  reorderAlbums,
} from "@/features/library/albumOps";
import { getTrackSourceMix } from "@/features/editor/audioTaggerUtils";
import type { DestructiveActionDialogProps } from "@/features/workspace/DestructiveActionDialog";
import {
  subscribeToEditorKeyboardShortcuts,
  type EditorKeyboardShortcutActions,
} from "@/features/editor/editorKeyboardShortcuts";
import { applyTrackOrderNumbersToFiles } from "@/features/library/fileMetadataOps";
import type { TagSidebarPanelProps } from "@/features/library/TagSidebarPanel";
import type { TrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AppSettings } from "@/features/library/types";
import type { SetActiveView } from "@/features/workspace/audioWorkspaceTypes";

type SelectionEditor = Pick<TrackEditorSession, "isCoverProcessing"> & {
  commands: Pick<TrackEditorSession["commands"], "flush">;
};

type SelectionSidebarProps = Pick<
  TagSidebarPanelProps,
  | "onSelectAlbum"
  | "onSelectFile"
  | "onSelectLooseTrack"
  | "onClearSelection"
  | "onRemoveFile"
  | "onMoveTrackToAlbum"
  | "onMoveTrackToLoose"
  | "onReorderAlbums"
>;

export const useWorkspaceSelection = ({
  library,
  editor,
  settings,
  setActiveView,
  removeDownloads,
}: {
  library: LibraryStore;
  editor: SelectionEditor;
  settings: AppSettings;
  setActiveView: SetActiveView;
  removeDownloads: (trackIds: string[]) => void;
}): {
  removalDialogProps: DestructiveActionDialogProps;
  sidebarProps: SelectionSidebarProps;
} => {
  const [removalDialog, setRemovalDialog] = useState<{
    open: boolean;
    trackIds: string[];
  }>({ open: false, trackIds: [] });
  const editorRef = useRef(editor);
  const settingsRef = useRef(settings);
  const removeDownloadsRef = useRef(removeDownloads);
  useLayoutEffect(() => {
    editorRef.current = editor;
    settingsRef.current = settings;
    removeDownloadsRef.current = removeDownloads;
  }, [editor, removeDownloads, settings]);

  const removeFiles = useCallback(
    (idsToRemove: string[]) => {
      const snapshot = library.getSnapshot();
      const idSet = new Set(idsToRemove);
      const removedFiles = snapshot.files.filter((file) => idSet.has(file.id));
      removeDownloadsRef.current(idsToRemove);
      const affectedAlbumIds: string[] = [];
      for (const album of snapshot.albums) {
        if (album.trackIds.some((trackId) => idSet.has(trackId))) {
          affectedAlbumIds.push(album.id);
        }
      }
      const nextAlbums = idsToRemove.reduce(
        (albums, fileId) => removeTrackFromAlbums(albums, fileId),
        snapshot.albums,
      );
      let nextFiles = snapshot.files.filter((file) => !idSet.has(file.id));
      if (settingsRef.current.syncTrackNumbers && affectedAlbumIds.length > 0) {
        nextFiles = applyTrackOrderNumbersToFiles(
          nextFiles,
          nextAlbums,
          affectedAlbumIds,
          settingsRef.current,
        );
      }
      library.dispatch({
        type: "tracks-removed",
        trackIds: idsToRemove,
        files: nextFiles,
        albums: nextAlbums,
      });
      if (removedFiles.length > 0) {
        analytics.capture({
          type: "tracks_removed",
          trackCount: removedFiles.length,
          sourceMix: getTrackSourceMix(removedFiles),
        });
      }
    },
    [library],
  );

  const clearSelection = useCallback(() => {
    if (editorRef.current.isCoverProcessing) return;
    setActiveView("editor");
    editorRef.current.commands.flush();
    library.dispatch({ type: "selection-cleared" });
  }, [library, setActiveView]);

  const requestRemoveSelected = useCallback(() => {
    const snapshot = library.getSnapshot();
    if (editorRef.current.isCoverProcessing || snapshot.selectedFileIds.size === 0) return;
    setRemovalDialog({ open: true, trackIds: Array.from(snapshot.selectedFileIds) });
  }, [library]);

  const selectAll = useCallback(() => {
    if (editorRef.current.isCoverProcessing) return;
    editorRef.current.commands.flush();
    library.dispatch({ type: "all-tracks-selected" });
  }, [library]);

  const keyboardActionsRef = useRef<EditorKeyboardShortcutActions>({
    selectedFileCount: library.state.selectedFileIds.size,
    isTrackCoverProcessing: editor.isCoverProcessing,
    selectAllFiles: selectAll,
    requestRemoveSelectedFiles: requestRemoveSelected,
    clearSelection,
  });
  useLayoutEffect(() => {
    keyboardActionsRef.current = {
      selectedFileCount: library.state.selectedFileIds.size,
      isTrackCoverProcessing: editor.isCoverProcessing,
      selectAllFiles: selectAll,
      requestRemoveSelectedFiles: requestRemoveSelected,
      clearSelection,
    };
  }, [
    clearSelection,
    editor.isCoverProcessing,
    library.state.selectedFileIds.size,
    requestRemoveSelected,
    selectAll,
  ]);
  useEffect(() => subscribeToEditorKeyboardShortcuts(window, () => keyboardActionsRef.current), []);

  const moveTrack = useCallback(
    (
      trackId: string,
      destination: { type: "loose" } | { type: "album"; albumId: string },
      placement: "before" | "after" | "append",
      referenceTrackId?: string,
    ) => {
      if (editorRef.current.isCoverProcessing) return;
      setActiveView("editor");
      editorRef.current.commands.flush();
      const snapshot = library.getSnapshot();
      const target =
        destination.type === "loose"
          ? placement === "append" || !referenceTrackId
            ? ({ type: "loose", placement: "append" } as const)
            : ({ type: "loose", placement, referenceTrackId } as const)
          : placement === "append" || !referenceTrackId
            ? ({ type: "album", albumId: destination.albumId, placement: "append" } as const)
            : ({
                type: "album",
                albumId: destination.albumId,
                placement,
                referenceTrackId,
              } as const);
      const moved = moveTrackInSidebar(
        snapshot.albums,
        snapshot.looseTrackIds,
        trackId,
        target,
        settingsRef.current,
      );
      let finalFiles = snapshot.files;
      if (moved.albumsToSync.length > 0) {
        finalFiles = applyTrackOrderNumbersToFiles(
          finalFiles,
          moved.albums,
          moved.albumsToSync,
          settingsRef.current,
        );
      }
      library.dispatch({
        type: "content-replaced",
        files: finalFiles,
        albums: moved.albums,
        looseTrackIds: moved.looseTrackIds,
        selection: {
          selectedAlbumId: destination.type === "loose" ? null : destination.albumId,
          selectedFileId: trackId,
        },
      });
    },
    [library, setActiveView],
  );

  const selectTrack = useCallback(
    (albumId: string | null, fileId: string, event?: ReactMouseEvent) => {
      if (editorRef.current.isCoverProcessing) return;
      setActiveView("editor");
      editorRef.current.commands.flush();
      const rangeSelection = Boolean(event?.shiftKey && library.getSnapshot().rangeAnchorFileId);
      library.dispatch({
        type: "track-selected",
        albumId,
        fileId,
        mode: rangeSelection ? "range" : event?.ctrlKey || event?.metaKey ? "toggle" : "replace",
      });
    },
    [library, setActiveView],
  );

  return {
    removalDialogProps: {
      open: removalDialog.open,
      itemCount: removalDialog.trackIds.length,
      onCancel: () => setRemovalDialog((current) => ({ ...current, open: false })),
      onConfirm: () => {
        const trackIds = removalDialog.trackIds;
        setRemovalDialog((current) => ({ ...current, open: false }));
        removeFiles(trackIds);
      },
    },
    sidebarProps: {
      onClearSelection: clearSelection,
      onSelectAlbum: (albumId, event) => {
        if (editorRef.current.isCoverProcessing) return;
        setActiveView("editor");
        editorRef.current.commands.flush();
        library.dispatch({
          type: "album-selected",
          albumId,
          mode: event?.ctrlKey || event?.metaKey ? "toggle" : "replace",
        });
      },
      onSelectFile: (albumId, fileId, event) => selectTrack(albumId, fileId, event),
      onSelectLooseTrack: (fileId, event) => selectTrack(null, fileId, event),
      onRemoveFile: (fileId) => {
        if (!editorRef.current.isCoverProcessing) {
          setRemovalDialog({ open: true, trackIds: [fileId] });
        }
      },
      onMoveTrackToAlbum: (trackId, albumId, placement, referenceTrackId) =>
        moveTrack(trackId, { type: "album", albumId }, placement, referenceTrackId),
      onMoveTrackToLoose: (trackId, placement, referenceTrackId) =>
        moveTrack(trackId, { type: "loose" }, placement, referenceTrackId),
      onReorderAlbums: (albumId, targetIndex) =>
        library.dispatch({
          type: "content-replaced",
          albums: reorderAlbums(library.getSnapshot().albums, albumId, targetIndex),
        }),
    },
  };
};
