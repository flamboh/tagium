import filenamify from "filenamify";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { SubmitHandler } from "react-hook-form";
import { analytics } from "@/analytics";
import {
  allTracksReadyForDownload,
  createLibraryDownloadFilename,
  createZipBlob,
  downloadBlob,
  getLibraryDownloadEntries,
  isTrackReadyForDownload,
} from "@/features/export/downloadLibrary";
import {
  applyAlbumSharedTagsToFiles,
  applySyncedFilenamesToFiles,
  applyTrackOrderNumbersToFiles,
} from "@/features/library/fileMetadataOps";
import { isValidFilenameBase } from "@/features/library/filename";
import { getSubmittedAudioMetadata } from "@/features/editor/audioTaggerUtils";
import { writeExportMetadata } from "@/features/export/exportMetadataWrites";
import { reportSystemFailure } from "@/features/workspace/systemFailure";
import type { TrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import {
  deriveExportConfirmationSummary,
  exportConfirmationSummariesMatch,
  type ExportConfirmationSummary,
} from "@/features/export/exportConfirmation";

export interface ExportSession {
  exporting: boolean;
  confirmation: ExportConfirmationSummary | null;
  confirmationStatus: "ready" | "changed" | "unavailable";
  downloadAll: () => void;
  downloadAlbum: (albumId: string) => void;
  downloadTrack: SubmitHandler<AudioMetadata>;
  cancelConfirmation: () => void;
  confirmDownload: () => Promise<void>;
  restoreConfirmationFocus: () => void;
}

type ExportEditor = Pick<TrackEditorSession["commands"], "projectFiles" | "flush" | "updateTags">;

export const useExportSession = ({
  library,
  editor,
  settings,
}: {
  library: LibraryStore;
  editor: ExportEditor;
  settings: AppSettings;
}): ExportSession => {
  const [exporting, setExporting] = useState(false);
  const [confirmation, setConfirmation] = useState<ExportConfirmationSummary | null>(null);
  const [confirmationStatus, setConfirmationStatus] = useState<"ready" | "changed" | "unavailable">(
    "ready",
  );
  const confirmingRef = useRef(false);
  const confirmationTriggerRef = useRef<{ focus: () => void; isConnected?: boolean } | null>(null);
  const settingsRef = useRef(settings);
  useLayoutEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const updateTags = editor.updateTags;

  const prepareFiles = useCallback(
    (albumIds?: string[]) => {
      const snapshot = library.getSnapshot();
      const albumIdSet = albumIds && new Set(albumIds);
      const albumsToSync = albumIdSet
        ? snapshot.albums.filter((album) => albumIdSet.has(album.id))
        : snapshot.albums;
      const trackIds = albumIds ? albumsToSync.flatMap((album) => album.trackIds) : undefined;
      let syncedFiles = editor.flush(trackIds);

      for (const album of albumsToSync) {
        syncedFiles = applyAlbumSharedTagsToFiles(syncedFiles, album, settingsRef.current);
      }
      if (settingsRef.current.syncTrackNumbers) {
        syncedFiles = applyTrackOrderNumbersToFiles(
          syncedFiles,
          snapshot.albums,
          albumsToSync.map((album) => album.id),
          settingsRef.current,
        );
      }
      if (settingsRef.current.syncFilenames) {
        syncedFiles = applySyncedFilenamesToFiles(syncedFiles, trackIds);
      }
      library.dispatch({ type: "content-replaced", files: syncedFiles });
      return syncedFiles;
    },
    [editor, library],
  );

  const writeFiles = useCallback(
    (files: TagiumFile[]) => writeExportMetadata(files, updateTags),
    [updateTags],
  );

  const executeConfirmedExport = useCallback(
    async (target: ExportConfirmationSummary["target"]) => {
      const before = library.getSnapshot();
      const album =
        target.kind === "album"
          ? before.albums.find((entry) => entry.id === target.albumId)
          : undefined;
      if (target.kind === "album" && !album) return;
      const targetFiles = album
        ? album.trackIds
            .map((trackId) => before.files.find((file) => file.id === trackId))
            .filter((file): file is TagiumFile => Boolean(file))
        : before.files;
      if (
        targetFiles.length === 0 ||
        (album && targetFiles.length !== album.trackIds.length) ||
        !allTracksReadyForDownload(targetFiles)
      ) {
        return;
      }
      const trackCount = targetFiles.length;
      const albumCount = target.kind === "album" ? 1 : before.albums.length;
      analytics.capture({
        type: "export_started",
        exportKind: target.kind,
        trackCount,
        albumCount,
      });
      setExporting(true);
      try {
        const syncedFiles = prepareFiles(album ? [album.id] : undefined);
        const filesToWrite = album
          ? album.trackIds
              .map((id) => syncedFiles.find((file) => file.id === id))
              .filter((file): file is TagiumFile & { file: File; metadata: AudioMetadata } =>
                Boolean(file && isTrackReadyForDownload(file)),
              )
          : syncedFiles;
        if (filesToWrite.length !== trackCount || !allTracksReadyForDownload(filesToWrite)) {
          throw new Error(`${target.kind} export tracks were not ready.`);
        }
        await writeFiles(filesToWrite);

        const entries = album
          ? getLibraryDownloadEntries({
              albums: [album],
              looseTrackIds: [],
              files: library.getSnapshot().files,
              albumRoot: "",
              includeUnassignedFiles: false,
            })
          : getLibraryDownloadEntries(library.getSnapshot());
        if (entries.length === 0) throw new Error(`${target.kind} export had no entries.`);

        const blob = await createZipBlob(entries);
        const albumFilename = album && filenamify(album.title, { replacement: "-" });
        const filename = album
          ? albumFilename
            ? `${albumFilename}.zip`
            : "album.zip"
          : createLibraryDownloadFilename();
        downloadBlob(blob, filename);
        analytics.capture({
          type: "export_prepared",
          exportKind: target.kind,
          trackCount,
          albumCount,
          sizeBytes: blob.size,
        });
      } catch (error) {
        analytics.capture({ type: "export_failed", exportKind: target.kind, error });
        reportSystemFailure(error, "export");
      } finally {
        setExporting(false);
      }
    },
    [library, prepareFiles, writeFiles],
  );

  const deriveConfirmation = useCallback(
    (target: ExportConfirmationSummary["target"]) => {
      const snapshot = library.getSnapshot();
      const trackIds =
        target.kind === "album"
          ? snapshot.albums.find(({ id }) => id === target.albumId)?.trackIds
          : undefined;
      return deriveExportConfirmationSummary(
        { ...snapshot, files: editor.projectFiles(trackIds) },
        target,
        settingsRef.current,
      );
    },
    [editor, library],
  );

  const rememberConfirmationTrigger = useCallback(() => {
    if (typeof document === "undefined") return;
    const activeElement = document.activeElement;
    if (activeElement && "focus" in activeElement && typeof activeElement.focus === "function") {
      confirmationTriggerRef.current = activeElement as {
        focus: () => void;
        isConnected?: boolean;
      };
    }
  }, []);

  const restoreConfirmationFocus = useCallback(() => {
    const trigger = confirmationTriggerRef.current;
    confirmationTriggerRef.current = null;
    if (trigger && trigger.isConnected !== false) trigger.focus();
  }, []);

  const downloadAll = useCallback(() => {
    if (exporting || confirmingRef.current) return;
    const summary = deriveConfirmation({ kind: "library" });
    if (summary) {
      rememberConfirmationTrigger();
      setConfirmationStatus("ready");
      setConfirmation(summary);
    }
  }, [deriveConfirmation, exporting, rememberConfirmationTrigger]);

  const downloadAlbum = useCallback(
    (albumId: string) => {
      if (exporting || confirmingRef.current) return;
      const summary = deriveConfirmation({
        kind: "album",
        albumId,
      });
      if (summary) {
        rememberConfirmationTrigger();
        setConfirmationStatus("ready");
        setConfirmation(summary);
      }
    },
    [deriveConfirmation, exporting, rememberConfirmationTrigger],
  );

  const cancelConfirmation = useCallback(() => {
    if (!confirmingRef.current) setConfirmation(null);
  }, []);

  const confirmDownload = useCallback(async () => {
    if (!confirmation || confirmingRef.current) return;
    const latest = deriveConfirmation(confirmation.target);
    if (!latest) {
      setConfirmationStatus("unavailable");
      return;
    }
    if (!exportConfirmationSummariesMatch(confirmation, latest)) {
      setConfirmation(latest);
      setConfirmationStatus("changed");
      return;
    }

    confirmingRef.current = true;
    try {
      await executeConfirmedExport(confirmation.target);
    } finally {
      confirmingRef.current = false;
      setConfirmation(null);
    }
  }, [confirmation, deriveConfirmation, executeConfirmedExport]);

  const downloadTrack = useCallback<SubmitHandler<AudioMetadata>>(
    async (data) => {
      const selectedFile = library
        .getSnapshot()
        .files.find((file) => file.id === library.getSnapshot().selectedFileId);
      if (!selectedFile) return;
      const submittedData = getSubmittedAudioMetadata(
        data,
        settingsRef.current.syncFilenames,
        settingsRef.current.advancedMetadata,
        settingsRef.current.metadataLinks.albumArtist,
      );
      if (!isValidFilenameBase(submittedData.filename)) return;
      const fileId = selectedFile.id;
      analytics.capture({ type: "export_started", exportKind: "track", trackCount: 1 });
      setExporting(true);
      try {
        await updateTags(selectedFile, submittedData);
        const updatedFile = library.getSnapshot().files.find((file) => file.id === fileId);
        if (!updatedFile?.file) throw new Error("track export was not ready.");
        downloadBlob(updatedFile.file, updatedFile.filename);
        analytics.capture({
          type: "export_prepared",
          exportKind: "track",
          trackCount: 1,
          sizeBytes: updatedFile.file.size,
        });
      } catch (error) {
        analytics.capture({ type: "export_failed", exportKind: "track", error });
        reportSystemFailure(error, "export");
      } finally {
        setExporting(false);
      }
    },
    [library, updateTags],
  );

  return {
    exporting,
    confirmation,
    confirmationStatus,
    downloadAll,
    downloadAlbum,
    downloadTrack,
    cancelConfirmation,
    confirmDownload,
    restoreConfirmationFocus,
  };
};
