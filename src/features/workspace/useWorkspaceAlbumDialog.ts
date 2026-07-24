import { useCallback, useLayoutEffect, useReducer, useRef } from "react";
import { analytics } from "@/analytics";
import { createAlbumFromTracks, updateAlbumMetadata } from "@/features/library/albumOps";
import {
  albumDialogReducer,
  createAlbumDialogState,
  createOpenAlbumDialogAction,
  getAlbumDialogSubmission,
} from "@/features/editor/albumDialogState";
import type { AlbumMetadataDialogProps } from "@/features/editor/AlbumMetadataDialog";
import {
  applyAlbumCoverToFilesWithSelectedMetadata,
  applyAlbumSharedTagsToFiles,
  applySyncedFilenamesToFiles,
  applyTrackOrderNumbersToFiles,
  areAlbumTrackCoversSynced,
} from "@/features/library/fileMetadataOps";
import { getSampleAlbum } from "@/features/editor/sampleMetadata";
import type { TagSidebarPanelProps } from "@/features/library/TagSidebarPanel";
import type { TrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AppSettings } from "@/features/library/types";

type AlbumEditor = {
  commands: Pick<TrackEditorSession["commands"], "flush">;
  form: Pick<TrackEditorSession["form"], "reset">;
};

type AlbumSidebarProps = Pick<
  TagSidebarPanelProps,
  "onAddAlbum" | "onEditAlbum" | "onPromptCreateAlbumFromLooseTracks"
>;

export const useWorkspaceAlbumDialog = ({
  library,
  editor,
  settings,
  removeDownloads,
}: {
  library: LibraryStore;
  editor: AlbumEditor;
  settings: AppSettings;
  removeDownloads: (trackIds: string[]) => void;
}): { dialogProps: AlbumMetadataDialogProps; sidebarProps: AlbumSidebarProps } => {
  const [dialog, dispatchDialog] = useReducer(
    albumDialogReducer,
    undefined,
    createAlbumDialogState,
  );
  const editorRef = useRef(editor);
  const settingsRef = useRef(settings);
  const removeDownloadsRef = useRef(removeDownloads);
  useLayoutEffect(() => {
    editorRef.current = editor;
    settingsRef.current = settings;
    removeDownloadsRef.current = removeDownloads;
  }, [editor, removeDownloads, settings]);

  const openCreate = useCallback(
    (seedTrackIds: string[]) => {
      dispatchDialog(
        createOpenAlbumDialogAction(
          seedTrackIds,
          library.getSnapshot().files,
          seedTrackIds[0] ?? crypto.randomUUID(),
        ),
      );
    },
    [library],
  );

  const removeAlbum = useCallback(
    (albumId: string) => {
      const album = library.getSnapshot().albums.find((entry) => entry.id === albumId);
      if (!album) return;
      removeDownloadsRef.current(album.trackIds);
      library.dispatch({ type: "album-removed", albumId });
    },
    [library],
  );

  const save = useCallback(() => {
    const submission = getAlbumDialogSubmission(dialog);
    if (!submission) return;
    const snapshot = library.getSnapshot();
    if (submission.mode === "edit") {
      const currentAlbum = snapshot.albums.find((album) => album.id === submission.albumId);
      const updatedAlbums = updateAlbumMetadata(
        snapshot.albums,
        submission.albumId,
        submission.metadata,
      );
      const updatedAlbum = updatedAlbums.find((album) => album.id === submission.albumId) ?? null;
      let finalFiles = snapshot.files;
      if (updatedAlbum) {
        const bufferedFiles = editorRef.current.commands.flush(updatedAlbum.trackIds);
        const shouldSyncCover =
          Boolean(updatedAlbum.cover?.length) &&
          areAlbumTrackCoversSynced(bufferedFiles, updatedAlbum.trackIds, currentAlbum?.cover);
        let taggedFiles = applyAlbumSharedTagsToFiles(bufferedFiles, updatedAlbum);
        if (settingsRef.current.syncFilenames) {
          taggedFiles = applySyncedFilenamesToFiles(taggedFiles, updatedAlbum.trackIds);
        }
        if (shouldSyncCover && updatedAlbum.cover) {
          const covered = applyAlbumCoverToFilesWithSelectedMetadata(
            taggedFiles,
            updatedAlbum.trackIds,
            updatedAlbum.cover,
            library.getSnapshot().selectedFileId,
          );
          taggedFiles = covered.files;
          if (covered.selectedMetadata) {
            editorRef.current.form.reset(covered.selectedMetadata);
          }
        }
        const selectedMetadata = taggedFiles.find(
          (file) => file.id === library.getSnapshot().selectedFileId,
        )?.metadata;
        if (selectedMetadata) editorRef.current.form.reset(selectedMetadata);
        finalFiles = taggedFiles;
        analytics.capture({
          type: "album_edited",
          trackCount: updatedAlbum.trackIds.length,
          hasCover: Boolean(updatedAlbum.cover?.length),
        });
      }
      library.dispatch({ type: "content-replaced", files: finalFiles, albums: updatedAlbums });
      dispatchDialog({ type: "saved" });
      return;
    }

    const created = createAlbumFromTracks(
      snapshot.albums,
      snapshot.looseTrackIds,
      submission.seedTrackIds,
      submission.metadata,
      settingsRef.current,
    );
    let finalFiles = snapshot.files;
    if (created.syncAlbums.length > 0) {
      finalFiles = applyTrackOrderNumbersToFiles(finalFiles, created.albums, created.syncAlbums);
    }
    if (created.newAlbumId) {
      const createdAlbum = created.albums.find((album) => album.id === created.newAlbumId);
      if (createdAlbum) {
        const taggedFiles = applyAlbumSharedTagsToFiles(finalFiles, createdAlbum);
        finalFiles = settingsRef.current.syncFilenames
          ? applySyncedFilenamesToFiles(taggedFiles, createdAlbum.trackIds)
          : taggedFiles;
        analytics.capture({
          type: "album_created",
          trackCount: createdAlbum.trackIds.length,
          hasCover: Boolean(createdAlbum.cover?.length),
        });
      }
    }
    library.dispatch({
      type: "content-replaced",
      files: finalFiles,
      albums: created.albums,
      looseTrackIds: created.looseTrackIds,
      ...(created.newAlbumId
        ? {
            selection: {
              selectedAlbumId: created.newAlbumId,
              selectedFileId: submission.seedTrackIds[0] ?? null,
            },
          }
        : {}),
    });
    dispatchDialog({ type: "saved" });
  }, [dialog, library]);

  const syncCover = useCallback(() => {
    if (dialog.mode !== "edit" || !dialog.editingAlbumId || !dialog.draft.cover?.length) return;
    const album = library.getSnapshot().albums.find((entry) => entry.id === dialog.editingAlbumId);
    if (!album) return;
    const bufferedFiles = editorRef.current.commands.flush(album.trackIds);
    const covered = applyAlbumCoverToFilesWithSelectedMetadata(
      bufferedFiles,
      album.trackIds,
      dialog.draft.cover,
      library.getSnapshot().selectedFileId,
    );
    library.dispatch({ type: "content-replaced", files: covered.files });
    if (covered.selectedMetadata) {
      editorRef.current.form.reset(covered.selectedMetadata);
    }
  }, [dialog, library]);

  const editingAlbumId = dialog.mode === "edit" ? dialog.editingAlbumId : null;
  return {
    dialogProps: {
      instanceKey: dialog.open ? (editingAlbumId ?? `create:${dialog.placeholderSeed}`) : "closed",
      open: dialog.open,
      mode: dialog.mode,
      draft: dialog.draft,
      placeholder: getSampleAlbum(dialog.placeholderSeed),
      trackCount: editingAlbumId
        ? (library.state.albums.find((album) => album.id === editingAlbumId)?.trackIds.length ?? 0)
        : 0,
      onChange: (update) => dispatchDialog({ type: "draft-changed", update }),
      onClose: () => dispatchDialog({ type: "closed" }),
      onSave: save,
      onSyncCoverToTracks: syncCover,
      onDelete: editingAlbumId
        ? () => {
            removeAlbum(editingAlbumId);
            dispatchDialog({ type: "deleted" });
          }
        : undefined,
    },
    sidebarProps: {
      onAddAlbum: () => {
        editorRef.current.commands.flush();
        openCreate([]);
      },
      onEditAlbum: (albumId) => {
        const album = library.getSnapshot().albums.find((entry) => entry.id === albumId);
        if (album) dispatchDialog({ type: "edit-opened", album });
      },
      onPromptCreateAlbumFromLooseTracks: (sourceTrackId, targetTrackId) => {
        if (sourceTrackId === targetTrackId) return;
        editorRef.current.commands.flush();
        const idSet = new Set([sourceTrackId, targetTrackId]);
        const orderedIds = library
          .getSnapshot()
          .looseTrackIds.filter((trackId) => idSet.has(trackId));
        if (orderedIds.length >= 2) openCreate(orderedIds);
      },
    },
  };
};
