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
import type { AlbumGroup, AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import {
  planExport,
  samePlan,
  type ExportPlan,
  type ExportTarget,
} from "@/features/export/exportConfirmation";

export interface ExportSession {
  exporting: boolean;
  confirmation: ExportPlan | null;
  confirmationStatus: "ready" | "changed" | "unavailable";
  downloadAll: () => void;
  downloadAlbum: (albumId: string) => void;
  downloadTrack: SubmitHandler<AudioMetadata>;
  cancelConfirmation: () => void;
  confirmDownload: () => Promise<void>;
  restoreConfirmationFocus: () => void;
}

type ExportEditor = Pick<TrackEditorSession["commands"], "projectFiles" | "flush" | "updateTags">;
type ExecutionResult = "success" | "unavailable" | "error";
type ConfirmationFocusTarget = {
  focus: () => void;
  isConnected?: boolean;
  checkVisibility?: () => boolean;
};

const canRestoreFocus = (target: ConfirmationFocusTarget) =>
  target.isConnected !== false && (target.checkVisibility?.() ?? true);

const planTrackIds = (plan: ExportPlan) =>
  plan.groups.flatMap((group) => group.tracks.map((track) => track.id));

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
  const [confirmation, setConfirmation] = useState<ExportPlan | null>(null);
  const [confirmationStatus, setConfirmationStatus] = useState<"ready" | "changed" | "unavailable">(
    "ready",
  );
  const confirmingRef = useRef(false);
  const confirmationTriggerRef = useRef<ConfirmationFocusTarget | null>(null);
  const settingsRef = useRef(settings);
  useLayoutEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const updateTags = editor.updateTags;

  const targetContext = useCallback(
    (target: ExportTarget) => {
      const snapshot = library.getSnapshot();
      const album =
        target.kind === "album"
          ? snapshot.albums.find((entry) => entry.id === target.albumId)
          : undefined;
      if (target.kind === "album" && !album) return null;
      const albums = album ? [album] : snapshot.albums;
      return {
        snapshot,
        album,
        albums,
        trackIds: album?.trackIds,
      };
    },
    [library],
  );

  const applyExportProjection = useCallback(
    (files: TagiumFile[], albums: AlbumGroup[], allAlbums: AlbumGroup[], trackIds?: string[]) => {
      let projectedFiles = files;
      for (const album of albums) {
        projectedFiles = applyAlbumSharedTagsToFiles(projectedFiles, album, settingsRef.current);
      }
      if (settingsRef.current.syncTrackNumbers) {
        projectedFiles = applyTrackOrderNumbersToFiles(
          projectedFiles,
          allAlbums,
          albums.map((album) => album.id),
          settingsRef.current,
        );
      }
      if (settingsRef.current.syncFilenames) {
        projectedFiles = applySyncedFilenamesToFiles(projectedFiles, trackIds);
      }
      return projectedFiles;
    },
    [],
  );

  const projectExportFiles = useCallback(
    (target: ExportTarget) => {
      const context = targetContext(target);
      if (!context) return null;
      return {
        context,
        files: applyExportProjection(
          editor.projectFiles(context.trackIds),
          context.albums,
          context.snapshot.albums,
          context.trackIds,
        ),
      };
    },
    [applyExportProjection, editor, targetContext],
  );

  const prepareFiles = useCallback(
    (target: ExportTarget) => {
      const context = targetContext(target);
      if (!context) return null;
      const files = applyExportProjection(
        editor.flush(context.trackIds),
        context.albums,
        context.snapshot.albums,
        context.trackIds,
      );
      library.dispatch({ type: "content-replaced", files });
      return { context, files };
    },
    [applyExportProjection, editor, library, targetContext],
  );

  const derivePlan = useCallback(
    (target: ExportTarget) => {
      const projection = projectExportFiles(target);
      if (!projection) return null;
      return planExport(
        { ...projection.context.snapshot, files: projection.files },
        target,
        settingsRef.current,
      );
    },
    [projectExportFiles],
  );

  const writeFiles = useCallback(
    (files: TagiumFile[]) => writeExportMetadata(files, updateTags),
    [updateTags],
  );

  const executeConfirmedExport = useCallback(
    async (plan: ExportPlan): Promise<ExecutionResult> => {
      const target = plan.target;
      const expectedTrackIds = planTrackIds(plan);
      setExporting(true);
      try {
        const prepared = prepareFiles(target);
        if (!prepared) return "unavailable";
        const filesById = new Map(prepared.files.map((file) => [file.id, file]));
        const filesToWrite = expectedTrackIds
          .map((id) => filesById.get(id))
          .filter((file): file is TagiumFile => Boolean(file));
        if (
          filesToWrite.length !== expectedTrackIds.length ||
          !allTracksReadyForDownload(filesToWrite)
        ) {
          return "unavailable";
        }
        const frozenState = {
          ...prepared.context.snapshot,
          files: prepared.files,
        };
        const frozenPlan = planExport(frozenState, target, settingsRef.current);
        if (!frozenPlan || !samePlan(plan, frozenPlan)) return "unavailable";

        const albumCount = target.kind === "album" ? 1 : prepared.context.albums.length;
        analytics.capture({
          type: "export_started",
          exportKind: target.kind,
          trackCount: expectedTrackIds.length,
          albumCount,
        });
        await writeFiles(filesToWrite);

        const currentProjection = projectExportFiles(target);
        if (!currentProjection) return "unavailable";
        const snapshot = currentProjection.context.snapshot;
        const frozenFilesById = new Map(prepared.files.map((file) => [file.id, file]));
        const currentFilesById = new Map(currentProjection.files.map((file) => [file.id, file]));
        const rewrittenFiles = expectedTrackIds.map((id) => currentFilesById.get(id));
        if (rewrittenFiles.some((file) => !file || !isTrackReadyForDownload(file))) {
          return "unavailable";
        }
        const validationFiles = currentProjection.files.map((file) => {
          const frozenFile = frozenFilesById.get(file.id);
          return frozenFile
            ? {
                ...file,
                file: frozenFile.file,
                pendingMetadataPatch: frozenFile.pendingMetadataPatch,
              }
            : file;
        });
        const validationPlan = planExport(
          { ...snapshot, files: validationFiles },
          target,
          settingsRef.current,
        );
        if (!validationPlan || !samePlan(frozenPlan, validationPlan)) return "unavailable";

        const exportFiles = prepared.files.map((file) => {
          const rewrittenFile = currentFilesById.get(file.id);
          return rewrittenFile?.file ? { ...file, file: rewrittenFile.file } : file;
        });
        const exportState = { ...frozenState, files: exportFiles };
        const album =
          target.kind === "album"
            ? exportState.albums.find((entry) => entry.id === target.albumId)
            : undefined;
        if (target.kind === "album" && !album) return "unavailable";
        const entries = album
          ? getLibraryDownloadEntries({
              albums: [album],
              looseTrackIds: [],
              files: exportState.files,
              albumRoot: "",
              includeUnassignedFiles: false,
            })
          : getLibraryDownloadEntries(exportState);
        if (entries.length === 0) return "unavailable";

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
          trackCount: expectedTrackIds.length,
          albumCount,
          sizeBytes: blob.size,
        });
        return "success";
      } catch (error) {
        analytics.capture({ type: "export_failed", exportKind: target.kind, error });
        reportSystemFailure(error, "export");
        return "error";
      } finally {
        setExporting(false);
      }
    },
    [prepareFiles, projectExportFiles, writeFiles],
  );

  const rememberConfirmationTrigger = useCallback(() => {
    if (typeof document === "undefined") return;
    const activeElement = document.activeElement;
    if (activeElement && "focus" in activeElement && typeof activeElement.focus === "function") {
      confirmationTriggerRef.current = activeElement as ConfirmationFocusTarget;
    }
  }, []);

  const restoreConfirmationFocus = useCallback(() => {
    const trigger = confirmationTriggerRef.current;
    confirmationTriggerRef.current = null;
    if (trigger && canRestoreFocus(trigger)) {
      trigger.focus();
      return;
    }
    if (typeof document !== "undefined") {
      const fallback = Array.from(
        document.querySelectorAll<HTMLElement>("[data-export-focus-fallback]"),
      ).find(canRestoreFocus);
      fallback?.focus();
    }
  }, []);

  const requestConfirmation = useCallback(
    (target: ExportTarget) => {
      if (exporting || confirmingRef.current) return;
      const nextPlan = derivePlan(target);
      if (!nextPlan) return;
      rememberConfirmationTrigger();
      setConfirmationStatus("ready");
      setConfirmation(nextPlan);
    },
    [derivePlan, exporting, rememberConfirmationTrigger],
  );

  const downloadAll = useCallback(
    () => requestConfirmation({ kind: "library" }),
    [requestConfirmation],
  );

  const downloadAlbum = useCallback(
    (albumId: string) => requestConfirmation({ kind: "album", albumId }),
    [requestConfirmation],
  );

  const cancelConfirmation = useCallback(() => {
    if (confirmingRef.current) return;
    setConfirmationStatus("ready");
    setConfirmation(null);
  }, []);

  const confirmDownload = useCallback(async () => {
    if (!confirmation || confirmingRef.current) return;
    const latestPlan = derivePlan(confirmation.target);
    if (!latestPlan) {
      setConfirmationStatus("unavailable");
      return;
    }
    if (!samePlan(confirmation, latestPlan)) {
      setConfirmation(latestPlan);
      setConfirmationStatus("changed");
      return;
    }

    confirmingRef.current = true;
    try {
      const result = await executeConfirmedExport(latestPlan);
      if (result === "success") {
        setConfirmationStatus("ready");
        setConfirmation(null);
      } else if (result === "unavailable") {
        setConfirmationStatus("unavailable");
      }
    } finally {
      confirmingRef.current = false;
    }
  }, [confirmation, derivePlan, executeConfirmedExport]);

  const downloadTrack = useCallback<SubmitHandler<AudioMetadata>>(
    async (data) => {
      const selectedFile = library
        .getSnapshot()
        .files.find((file) => file.id === library.getSnapshot().selectedFileId);
      if (!selectedFile) return;
      const submittedData = getSubmittedAudioMetadata(data, settingsRef.current.syncFilenames);
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
