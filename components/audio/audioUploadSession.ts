import { analytics } from "@/src/analytics";
import { toast } from "sonner";
import { mergeUploadedTracksIntoAlbums } from "./albumOps";
import { parseUploads, runAudioBackendEffect } from "./audioBackend";
import {
  getAcceptedUploadParseResult,
  getFileImportKey,
  getTagiumFileImportKey,
  getUploadRejectionMessage,
} from "./audioTaggerUtils";
import {
  applyAlbumSharedTagsToFiles,
  applySyncedFilenamesToFiles,
  applyTrackOrderNumbersToFiles,
} from "./fileMetadataOps";
import { fetchImportedCover } from "./downloadTrack";
import { sortTrackIdsByTrackNumber, sortUploadedTracksByTrackNumber } from "./mp3Utils";
import { reportSystemFailure } from "./systemFailure";
import type { LibraryStore } from "./useLibraryStore";
import type { AlbumGroup, AppSettings, AudioMetadata, ImportedAlbumMetadata } from "./types";

const asUniqueTrackIds = (trackIds: string[]) => [...new Set(trackIds)];

export interface AudioUploadSession {
  upload: (
    files: File[],
    targetAlbumId?: string,
    importedAlbum?: ImportedAlbumMetadata,
  ) => Promise<void>;
}

export const createAudioUploadSession = ({
  library,
  getSettings,
  bufferEditor,
  activateEditor,
  setUploading,
}: {
  library: LibraryStore;
  getSettings: () => AppSettings;
  bufferEditor: () => void;
  activateEditor: () => void;
  setUploading: (uploading: boolean) => void;
}): AudioUploadSession => {
  let importQueue: Promise<void> | null = null;
  const pendingImportKeys = new Set<string>();

  const upload: AudioUploadSession["upload"] = async (
    uploadedFiles,
    targetAlbumId,
    importedAlbum,
  ) => {
    bufferEditor();
    const runImport = async () => {
      activateEditor();
      const existingImportKeys = new Set(
        library
          .getSnapshot()
          .files.map(getTagiumFileImportKey)
          .filter((key): key is string => Boolean(key)),
      );
      const reservedImportKeys: string[] = [];
      const uniqueUploadedFiles = uploadedFiles.filter((file) => {
        const importKey = getFileImportKey(file);
        if (existingImportKeys.has(importKey) || pendingImportKeys.has(importKey)) return false;
        existingImportKeys.add(importKey);
        pendingImportKeys.add(importKey);
        reservedImportKeys.push(importKey);
        return true;
      });
      let acceptedCount = 0;
      let parseRejectedCount = 0;
      let targetKind: "loose" | "album" = targetAlbumId || importedAlbum ? "album" : "loose";
      const captureResult = () =>
        analytics.capture({
          type: "audio_upload_completed",
          requestedCount: uploadedFiles.length,
          acceptedCount,
          duplicateCount: uploadedFiles.length - uniqueUploadedFiles.length,
          parseRejectedCount,
          targetKind,
        });
      if (uniqueUploadedFiles.length === 0) {
        captureResult();
        return;
      }

      setUploading(true);
      try {
        const parsedUploads = await runAudioBackendEffect(parseUploads(uniqueUploadedFiles));
        const parseResult = getAcceptedUploadParseResult(parsedUploads);
        const acceptedUploads = parseResult.acceptedUploads;
        acceptedCount = acceptedUploads.length;
        parseRejectedCount = parseResult.parseRejectedCount;
        const rejectedUploads = parsedUploads.filter((entry) => entry.file.status === "error");
        if (rejectedUploads.length > 0) {
          toast.error(
            `${rejectedUploads.length} ${rejectedUploads.length === 1 ? "file" : "files"} could not be imported`,
            { description: getUploadRejectionMessage(rejectedUploads) },
          );
        }
        if (acceptedUploads.length === 0) return;
        const orderedUploads = sortUploadedTracksByTrackNumber(acceptedUploads);
        const beforeAppend = library.getSnapshot();
        const nextFiles = [
          ...beforeAppend.files,
          ...orderedUploads.map((entry) => ({
            ...entry.file,
            sourceImportKey: entry.file.originalFile
              ? getFileImportKey(entry.file.originalFile)
              : undefined,
          })),
        ];
        library.dispatch({ type: "content-replaced", files: nextFiles });

        const current = library.getSnapshot();
        const hasTargetAlbum = Boolean(
          targetAlbumId && current.albums.some((album) => album.id === targetAlbumId),
        );
        const forceSingleAlbum =
          !hasTargetAlbum && (acceptedUploads.length > 1 || Boolean(importedAlbum));
        if (hasTargetAlbum || forceSingleAlbum || importedAlbum) targetKind = "album";

        if (hasTargetAlbum && targetAlbumId) {
          const uploadedTrackIds = orderedUploads.map((entry) => entry.file.id);
          const nextAlbums = current.albums.map((album) =>
            album.id === targetAlbumId
              ? {
                  ...album,
                  trackIds: sortTrackIdsByTrackNumber(
                    asUniqueTrackIds([...album.trackIds, ...uploadedTrackIds]),
                    current.files,
                  ),
                }
              : album,
          );
          const targetAlbum = nextAlbums.find((album) => album.id === targetAlbumId);
          let finalFiles = current.files;
          if (targetAlbum) {
            finalFiles = applyAlbumSharedTagsToFiles(finalFiles, targetAlbum);
            const settings = getSettings();
            if (settings.syncFilenames) {
              finalFiles = applySyncedFilenamesToFiles(finalFiles, targetAlbum.trackIds);
            }
            if (settings.syncTrackNumbers) {
              finalFiles = applyTrackOrderNumbersToFiles(finalFiles, nextAlbums, [targetAlbumId]);
            }
          }
          library.dispatch({
            type: "content-replaced",
            files: finalFiles,
            albums: nextAlbums,
            selection: {
              selectedFileId: orderedUploads[0].file.id,
              selectedAlbumId: targetAlbumId,
            },
          });
        } else if (importedAlbum) {
          let importedCover: AudioMetadata["picture"] | undefined;
          if (importedAlbum.coverUrl) {
            try {
              importedCover = await fetchImportedCover(importedAlbum.coverUrl);
            } catch (error) {
              reportSystemFailure(error, "cover-import");
            }
          }
          const embeddedCover = acceptedUploads.find((entry) => entry.albumSeed.cover)?.albumSeed
            .cover;
          const downloadedAlbum: AlbumGroup = {
            id: crypto.randomUUID(),
            title: importedAlbum.title,
            artist: importedAlbum.artist,
            genre: importedAlbum.genre,
            cover: importedCover ?? embeddedCover,
            trackIds: orderedUploads.map((entry) => entry.file.id),
            year: importedAlbum.year,
          };
          const latest = library.getSnapshot();
          const nextAlbums = [...latest.albums, downloadedAlbum];
          let finalFiles = applyAlbumSharedTagsToFiles(latest.files, downloadedAlbum);
          const settings = getSettings();
          if (settings.syncFilenames) {
            finalFiles = applySyncedFilenamesToFiles(finalFiles, downloadedAlbum.trackIds);
          }
          if (settings.syncTrackNumbers) {
            finalFiles = applyTrackOrderNumbersToFiles(finalFiles, nextAlbums, [
              downloadedAlbum.id,
            ]);
          }
          library.dispatch({
            type: "content-replaced",
            files: finalFiles,
            albums: nextAlbums,
            selection: {
              selectedFileId: orderedUploads[0].file.id,
              selectedAlbumId: downloadedAlbum.id,
            },
          });
        } else {
          const latest = library.getSnapshot();
          const settings = getSettings();
          const merged = mergeUploadedTracksIntoAlbums(latest.albums, orderedUploads, {
            forceSingleAlbum,
            albumSeedUploads: acceptedUploads,
            settings,
          });
          const nextLooseTrackIds =
            !forceSingleAlbum && merged.unassignedTrackIds.length > 0
              ? asUniqueTrackIds([...latest.looseTrackIds, ...merged.unassignedTrackIds])
              : latest.looseTrackIds;
          let finalFiles = latest.files;
          const uploadedTrackIds = orderedUploads.map((entry) => entry.file.id);
          if (settings.syncFilenames) {
            finalFiles = applySyncedFilenamesToFiles(finalFiles, uploadedTrackIds);
          }
          if (merged.albumsToSync.length > 0) {
            finalFiles = applyTrackOrderNumbersToFiles(
              finalFiles,
              merged.albums,
              merged.albumsToSync,
            );
          }
          const firstTrack = orderedUploads[0];
          const firstTrackIsLoose = merged.unassignedTrackIds.includes(firstTrack.file.id);
          targetKind = firstTrackIsLoose ? "loose" : "album";
          library.dispatch({
            type: "content-replaced",
            files: finalFiles,
            albums: merged.albums,
            looseTrackIds: nextLooseTrackIds,
            selection: {
              selectedFileId: firstTrack.file.id,
              selectedAlbumId: firstTrackIsLoose ? null : merged.firstSelectedAlbumId,
            },
          });
        }
      } finally {
        reservedImportKeys.forEach((key) => pendingImportKeys.delete(key));
        setUploading(false);
        captureResult();
      }
    };

    const queuedImport = (importQueue ?? Promise.resolve()).then(runImport, runImport);
    importQueue = queuedImport.catch(() => undefined);
    await queuedImport;
  };

  return { upload };
};
