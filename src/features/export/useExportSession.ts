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

export interface ExportSession {
  exporting: boolean;
  downloadAll: () => Promise<void>;
  downloadAlbum: (albumId: string) => Promise<void>;
  downloadTrack: SubmitHandler<AudioMetadata>;
}

type ExportEditor = Pick<TrackEditorSession["commands"], "flush" | "updateTags">;

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

  const downloadAll = useCallback(async () => {
    const before = library.getSnapshot();
    if (before.files.length === 0 || !allTracksReadyForDownload(before.files)) return;
    const trackCount = before.files.length;
    const albumCount = before.albums.length;
    analytics.capture({ type: "export_started", exportKind: "library", trackCount, albumCount });
    setExporting(true);
    try {
      const syncedFiles = prepareFiles();
      if (!allTracksReadyForDownload(syncedFiles)) return;
      await writeFiles(syncedFiles);
      const snapshot = library.getSnapshot();
      const entries = getLibraryDownloadEntries(snapshot);
      if (entries.length === 0) throw new Error("library export had no entries.");

      const blob = await createZipBlob(entries);
      downloadBlob(blob, createLibraryDownloadFilename());
      analytics.capture({
        type: "export_prepared",
        exportKind: "library",
        trackCount,
        albumCount,
        sizeBytes: blob.size,
      });
    } catch (error) {
      analytics.capture({ type: "export_failed", exportKind: "library", error });
      reportSystemFailure(error, "export");
    } finally {
      setExporting(false);
    }
  }, [library, prepareFiles, writeFiles]);

  const downloadAlbum = useCallback(
    async (albumId: string) => {
      const before = library.getSnapshot();
      const album = before.albums.find((entry) => entry.id === albumId);
      if (!album) return;
      const currentAlbumFiles = album.trackIds
        .map((trackId) => before.files.find((file) => file.id === trackId))
        .filter((file): file is TagiumFile => Boolean(file));
      if (
        currentAlbumFiles.length !== album.trackIds.length ||
        !allTracksReadyForDownload(currentAlbumFiles)
      ) {
        return;
      }
      const trackCount = album.trackIds.length;
      analytics.capture({ type: "export_started", exportKind: "album", trackCount, albumCount: 1 });
      setExporting(true);
      try {
        const syncedFiles = prepareFiles([albumId]);
        const albumFiles = album.trackIds
          .map((id) => syncedFiles.find((file) => file.id === id))
          .filter((file): file is TagiumFile & { file: File; metadata: AudioMetadata } =>
            Boolean(file && isTrackReadyForDownload(file)),
          );
        if (albumFiles.length !== album.trackIds.length) {
          throw new Error("album export tracks were not ready.");
        }
        await writeFiles(albumFiles);

        const entries = getLibraryDownloadEntries({
          albums: [album],
          looseTrackIds: [],
          files: library.getSnapshot().files,
          albumRoot: "",
          includeUnassignedFiles: false,
        });
        if (entries.length === 0) throw new Error("album export had no entries.");

        const blob = await createZipBlob(entries);
        const albumFilename = filenamify(album.title, { replacement: "-" });
        downloadBlob(blob, albumFilename ? `${albumFilename}.zip` : "album.zip");
        analytics.capture({
          type: "export_prepared",
          exportKind: "album",
          trackCount,
          albumCount: 1,
          sizeBytes: blob.size,
        });
      } catch (error) {
        analytics.capture({ type: "export_failed", exportKind: "album", error });
        reportSystemFailure(error, "export");
      } finally {
        setExporting(false);
      }
    },
    [library, prepareFiles, writeFiles],
  );

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

  return { exporting, downloadAll, downloadAlbum, downloadTrack };
};
