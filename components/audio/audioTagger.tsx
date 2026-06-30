"use client";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import filenamify from "filenamify";
import AlbumMetadataDialog, { AlbumMetadataDraft } from "./AlbumMetadataDialog";
import { downloadCobaltAudio } from "./cobaltDownload";
import {
  createAlbumFromTracks,
  mergeUploadedTracksIntoAlbums,
  moveTrackInSidebar,
  removeTrackFromAlbums,
  updateAlbumMetadata,
  reorderAlbums,
} from "./albumOps";
import {
  applyAlbumCoverToFiles,
  applyAlbumSharedTagsToFiles,
  applySyncedFilenamesToFiles,
  applyTrackOrderNumbersToFiles,
  prepareDownloadedTrackHydration,
  resolveDownloadedTrackHydrationWrite,
  resolveDownloadedTrackHydrationWriteError,
} from "./fileMetadataOps";
import {
  allTracksReadyForDownload,
  createLibraryDownloadFilename,
  createZipBlob,
  downloadBlob,
  getLibraryDownloadEntries,
} from "./downloadLibrary";
import TagSidebarPanel from "./TagSidebarPanel";
import type { PlaylistDownloadQueuePanelState } from "./PlaylistDownloadQueuePanel";
import {
  cancelActivePlaylistDownloadTracks,
  cancelPendingPlaylistDownloadTracks,
  createPlaylistDownloadQueueRun,
  derivePlaylistDownloadQueueState,
  enqueuePlaylistDownloadQueueTracks,
  finishPlaylistDownloadQueueRunIfIdle,
  markPlaylistDownloadTrackActive,
  markPlaylistDownloadTrackCanceled,
  markPlaylistDownloadTrackCompleted,
  markPlaylistDownloadTrackFailed,
  removeActivePlaylistDownloadTrack,
  reserveNextPlaylistDownloadTrack,
} from "./playlistDownloadQueueRuntime";
import type {
  PlaylistDownloadQueueRun as PlaylistDownloadQueueRuntimeRun,
  PlaylistDownloadQueueRuntimeSnapshot,
} from "./playlistDownloadQueueRuntime";
import LandingScreen from "./LandingScreen";
import TrackMetadataEditor from "./TrackMetadataEditor";
import SettingsPage from "./SettingsPage";
import AudioDownloader from "./AudioDownloader";
import {
  parseUploadedTracks,
  sortTrackIdsByTrackNumber,
  sortUploadedTracksByTrackNumber,
  toGenreString,
  writeMetadataToFile,
} from "./mp3Utils";
import { loadAppSettings, saveAppSettings } from "./settings";
import type { SoundCloudSet } from "./soundcloudSet";
import { AlbumGroup, AppSettings, AudioMetadata, ImportedAlbumMetadata, TagiumFile } from "./types";

type ActiveView = "editor" | "settings";
type DownloadRequest = NonNullable<TagiumFile["downloadRequest"]>;
type ManagedDownloadTrack = {
  fileId: string;
  title: string;
  downloadRequest: DownloadRequest;
};
type PlaylistDownloadQueueState = PlaylistDownloadQueueRuntimeSnapshot;
type PlaylistDownloadQueueRun = PlaylistDownloadQueueRuntimeRun<ManagedDownloadTrack> & {
  budgetWakeTimeout?: ReturnType<typeof setTimeout>;
  abortControllers: Map<string, AbortController>;
};

const EMPTY_ALBUM_DRAFT: AlbumMetadataDraft = {
  title: "",
  artist: "",
  genre: "",
  year: undefined,
  cover: undefined,
};
const PLAYLIST_DOWNLOAD_CONCURRENCY = 3;
const createPlaylistDownloadAbortReason = () =>
  new DOMException("playlist download canceled.", "AbortError");
const isPlaylistDownloadAbort = (error: unknown) => {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
};
const asUniqueTrackIds = (trackIds: string[]) => [...new Set(trackIds)];
const getFileImportKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
const filenameFromTitle = (title: string) => {
  const filename = filenamify(title.trim(), { replacement: "-" });
  if (filename) return `${filename}.mp3`;
  return "downloading-track.mp3";
};
const titleFromSourceUrl = (sourceUrl: string) => {
  try {
    const url = new URL(sourceUrl);
    const [lastPathPart] = url.pathname.split("/").filter(Boolean).slice(-1);
    if (lastPathPart) return decodeURIComponent(lastPathPart).replaceAll("-", " ");
    return url.hostname;
  } catch {
    return "downloading audio";
  }
};
const createDownloadMetadata = ({
  title,
  artist,
  album,
  genre,
  year,
  duration,
  trackNumber,
}: {
  title: string;
  artist: string;
  album: string;
  genre: string;
  year?: number;
  duration?: number;
  trackNumber?: number;
}): AudioMetadata => ({
  filename: filenameFromTitle(title).replace(/\.mp3$/i, ""),
  title,
  artist,
  album,
  year,
  genre,
  duration: duration ?? 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  trackNumber,
});
const createPendingDownloadTrack = (
  id: string,
  metadata: AudioMetadata,
  hasBufferedChanges: boolean,
  downloadRequest: TagiumFile["downloadRequest"],
): TagiumFile => ({
  id,
  filename: `${metadata.filename}.mp3`,
  status: "pending",
  downloadStatus: "downloading",
  downloadRequest,
  hasBufferedChanges,
  metadata,
});
const fetchImportedCover = async (coverUrl: string): Promise<AudioMetadata["picture"]> => {
  const response = await fetch(coverUrl);

  if (!response.ok) {
    throw new Error(`album cover request failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType) {
    throw new Error("album cover response missing content type.");
  }

  return [
    {
      format: contentType,
      type: 3,
      data: new Uint8Array(await response.arrayBuffer()),
      description: "album cover",
    },
  ];
};
const getManagedDownloadTrackTitle = (file: TagiumFile) => {
  if (file.metadata?.title) return file.metadata.title;
  return file.filename;
};
const formatPlaylistQueueEta = (etaMs?: number) => {
  if (etaMs === undefined) return null;

  const minutes = Math.ceil(etaMs / 60_000);
  if (minutes <= 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const leftoverMinutes = minutes % 60;
  if (leftoverMinutes === 0) return `${hours} hr`;
  return `${hours} hr ${leftoverMinutes} min`;
};
const createPlaylistDownloadModelTrack = (track: ManagedDownloadTrack) => ({
  id: track.fileId,
  title: track.title,
  sourceUrl: track.downloadRequest.sourceUrl,
});

export default function AudioTagger() {
  const [files, setFiles] = useState<TagiumFile[]>([]);
  const [albums, setAlbums] = useState<AlbumGroup[]>([]);
  const [looseTrackIds, setLooseTrackIds] = useState<string[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [lastSelectedFileId, setLastSelectedFileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [albumDialogOpen, setAlbumDialogOpen] = useState(false);
  const [albumDialogMode, setAlbumDialogMode] = useState<"create" | "edit">("create");
  const [albumDraft, setAlbumDraft] = useState<AlbumMetadataDraft>(EMPTY_ALBUM_DRAFT);
  const [editingAlbumId, setEditingAlbumId] = useState<string | null>(null);
  const [createSeedTrackIds, setCreateSeedTrackIds] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>("editor");
  const [settings, setSettings] = useState<AppSettings>(loadAppSettings);
  const [playlistDownloadQueue, setPlaylistDownloadQueue] =
    useState<PlaylistDownloadQueueState | null>(null);
  const filesRef = useRef<TagiumFile[]>(files);
  const albumsRef = useRef<AlbumGroup[]>(albums);
  const selectedFileIdRef = useRef<string | null>(selectedFileId);
  const lastResetFileIdRef = useRef<string | null>(null);
  const formDirtyRef = useRef(false);
  const importQueueRef = useRef(Promise.resolve());
  const pendingImportKeysRef = useRef(new Set<string>());
  const playlistDownloadQueueRef = useRef<PlaylistDownloadQueueState | null>(null);
  const playlistDownloadQueueRunRef = useRef<PlaylistDownloadQueueRun | null>(null);
  const playlistDownloadQueueIdRef = useRef(0);
  filesRef.current = files;
  albumsRef.current = albums;
  selectedFileIdRef.current = selectedFileId;
  const {
    register,
    handleSubmit,
    control,
    setValue,
    reset,
    getValues,
    formState: { dirtyFields },
  } = useForm<AudioMetadata>();
  formDirtyRef.current = Object.keys(dirtyFields).length > 0;
  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedFileId) ?? null,
    [files, selectedFileId],
  );
  const selectedFileAlbum = useMemo(
    () => (selectedFile ? albums.find((a) => a.trackIds.includes(selectedFile.id)) : undefined),
    [selectedFile, albums],
  );
  useLayoutEffect(() => {
    if (selectedFile?.metadata) {
      const selectedFileChanged = lastResetFileIdRef.current !== selectedFile.id;
      if (!selectedFileChanged && formDirtyRef.current) {
        return;
      }
      lastResetFileIdRef.current = selectedFile.id;
      reset(selectedFile.metadata);
    }
  }, [selectedFile, reset]);
  useEffect(() => {
    const fileIdSet = new Set(files.map((file) => file.id));
    setLooseTrackIds((prevLooseTrackIds) =>
      asUniqueTrackIds(prevLooseTrackIds.filter((trackId) => fileIdSet.has(trackId))),
    );
  }, [files]);
  useEffect(() => {
    const hasSelectedAlbum =
      !!selectedAlbumId && albums.some((album) => album.id === selectedAlbumId);
    const hasSelectedFile = !!selectedFileId && files.some((file) => file.id === selectedFileId);
    const isManuallyDeselected = selectedAlbumId === null && selectedFileId === null;
    if (isManuallyDeselected) {
      return;
    }
    if (hasSelectedFile) {
      return;
    }
    if (!selectedFileId && hasSelectedAlbum) {
      return;
    }
    if (looseTrackIds.length > 0 && !hasSelectedAlbum) {
      setSelectedAlbumId(null);
      setSelectedFileId(looseTrackIds[0]);
      return;
    }
    const firstAlbumWithTrack = albums.find((album) => album.trackIds.length > 0);
    if (firstAlbumWithTrack) {
      setSelectedAlbumId(firstAlbumWithTrack.id);
      setSelectedFileId(firstAlbumWithTrack.trackIds[0]);
      return;
    }
    setSelectedFileId(null);
    setSelectedAlbumId(null);
  }, [albums, files, looseTrackIds, selectedAlbumId, selectedFileId]);

  const handleTagUpdate = async (fileToUpdate: TagiumFile, newTags: AudioMetadata) => {
    const latestFileToUpdate =
      filesRef.current.find((file) => file.id === fileToUpdate.id) ?? fileToUpdate;

    if (!latestFileToUpdate.file) {
      const metadata = {
        ...newTags,
        year: Number.isNaN(newTags.year as number) ? undefined : newTags.year,
        trackNumber: Number.isNaN(newTags.trackNumber as number) ? undefined : newTags.trackNumber,
        duration: latestFileToUpdate.metadata?.duration || 0,
        bitrate: latestFileToUpdate.metadata?.bitrate || 0,
        sampleRate: latestFileToUpdate.metadata?.sampleRate || 0,
        picture: newTags.picture || [],
      };
      const nextFiles = filesRef.current.map((file) =>
        file.id === fileToUpdate.id
          ? {
              ...file,
              filename: newTags.filename ? `${newTags.filename}.mp3` : file.filename,
              metadata,
              status: "pending" as const,
              hasBufferedChanges: true,
            }
          : file,
      );
      filesRef.current = nextFiles;
      setFiles(nextFiles);
      if (selectedFileIdRef.current === fileToUpdate.id) {
        reset(metadata);
      }
      return;
    }

    try {
      const updatedFile = await writeMetadataToFile(latestFileToUpdate, newTags);
      const metadata = {
        ...newTags,
        year: Number.isNaN(newTags.year as number) ? undefined : newTags.year,
        trackNumber: Number.isNaN(newTags.trackNumber as number) ? undefined : newTags.trackNumber,
        duration: latestFileToUpdate.metadata?.duration || 0,
        bitrate: latestFileToUpdate.metadata?.bitrate || 0,
        sampleRate: latestFileToUpdate.metadata?.sampleRate || 0,
        picture: newTags.picture || [],
      };
      const nextFiles = filesRef.current.map((file) =>
        file.id === fileToUpdate.id
          ? {
              ...file,
              file: updatedFile,
              filename: updatedFile.name,
              metadata,
              status: "saved" as const,
              downloadStatus: "ready" as const,
              downloadError: undefined,
              hasBufferedChanges: false,
            }
          : file,
      );
      filesRef.current = nextFiles;
      setFiles(nextFiles);
      if (selectedFileIdRef.current === fileToUpdate.id) {
        reset(metadata);
      }
    } catch (error) {
      let message = "unable to save metadata.";
      if (error instanceof Error) {
        message = error.message;
      }
      const nextFiles = filesRef.current.map((file) =>
        file.id === fileToUpdate.id
          ? {
              ...file,
              status: "error" as const,
              metadata: {
                ...newTags,
                year: Number.isNaN(newTags.year as number) ? undefined : newTags.year,
                trackNumber: Number.isNaN(newTags.trackNumber as number)
                  ? undefined
                  : newTags.trackNumber,
                duration: file.metadata?.duration || 0,
                bitrate: file.metadata?.bitrate || 0,
                sampleRate: file.metadata?.sampleRate || 0,
                picture: newTags.picture || [],
              },
              filename: newTags.filename ? `${newTags.filename}.mp3` : file.filename,
              downloadError: message,
              hasBufferedChanges: true,
            }
          : file,
      );
      filesRef.current = nextFiles;
      setFiles(nextFiles);
      throw error;
    }
  };
  const getSubmittedMetadata = useCallback(
    (data: AudioMetadata) =>
      settings.syncFilenames
        ? { ...data, filename: filenamify(data.title, { replacement: "-" }) }
        : data,
    [settings.syncFilenames],
  );

  const applyCurrentFormMetadataToFiles = useCallback(
    (filesToSync: TagiumFile[], trackIds?: string[]) => {
      const selectedId = selectedFileIdRef.current;
      if (!selectedId || !formDirtyRef.current) return filesToSync;
      if (trackIds && !trackIds.includes(selectedId)) return filesToSync;

      const submittedData = getSubmittedMetadata(getValues());
      return filesToSync.map((file) =>
        file.id === selectedId
          ? {
              ...file,
              filename: submittedData.filename ? `${submittedData.filename}.mp3` : file.filename,
              metadata: submittedData,
              status: file.status === "saved" ? "pending" : file.status,
              hasBufferedChanges: true,
            }
          : file,
      );
    },
    [getSubmittedMetadata, getValues],
  );

  const bufferCurrentFormMetadata = useCallback(
    (trackIds?: string[]) => {
      const nextFiles = applyCurrentFormMetadataToFiles(filesRef.current, trackIds);
      if (nextFiles === filesRef.current) return;
      filesRef.current = nextFiles;
      setFiles(nextFiles);
    },
    [applyCurrentFormMetadataToFiles],
  );

  const prepareFilesForExport = (albumIds?: string[]) => {
    const albumsToSync = albumIds
      ? albumsRef.current.filter((album) => albumIds.includes(album.id))
      : albumsRef.current;
    const trackIds = albumIds ? albumsToSync.flatMap((album) => album.trackIds) : undefined;
    let syncedFiles = applyCurrentFormMetadataToFiles(filesRef.current, trackIds);

    for (const album of albumsToSync) {
      syncedFiles = applyAlbumSharedTagsToFiles(syncedFiles, album);
    }
    if (settings.syncTrackNumbers) {
      syncedFiles = applyTrackOrderNumbersToFiles(
        syncedFiles,
        albumsRef.current,
        albumsToSync.map((album) => album.id),
      );
    }
    if (settings.syncFilenames) {
      syncedFiles = applySyncedFilenamesToFiles(syncedFiles, trackIds);
    }
    filesRef.current = syncedFiles;
    setFiles(syncedFiles);
    return syncedFiles;
  };

  const writeFilesForExport = async (filesToExport: TagiumFile[]) => {
    for (const file of filesToExport) {
      if (!file.file) continue;
      if (!file.metadata) continue;
      await handleTagUpdate(file, file.metadata);
    }
  };

  const handleAudioUpload = async (
    uploadedFiles: File[],
    targetAlbumId?: string,
    importedAlbum?: ImportedAlbumMetadata,
  ) => {
    bufferCurrentFormMetadata();
    const runImport = async () => {
      setActiveView("editor");
      const existingImportKeys = new Set(
        filesRef.current
          .map((file) => file.originalFile)
          .filter((file): file is File => Boolean(file))
          .map((file) => getFileImportKey(file)),
      );
      const reservedImportKeys: string[] = [];
      const uniqueUploadedFiles = uploadedFiles.filter((file) => {
        const importKey = getFileImportKey(file);
        if (existingImportKeys.has(importKey) || pendingImportKeysRef.current.has(importKey)) {
          return false;
        }
        existingImportKeys.add(importKey);
        pendingImportKeysRef.current.add(importKey);
        reservedImportKeys.push(importKey);
        return true;
      });

      if (uniqueUploadedFiles.length === 0) return;

      setLoading(true);
      try {
        const parsedUploads = await parseUploadedTracks(uniqueUploadedFiles);
        if (parsedUploads.length === 0) return;
        const orderedUploads = sortUploadedTracksByTrackNumber(parsedUploads);

        const nextFiles = [...filesRef.current, ...orderedUploads.map((upload) => upload.file)];
        filesRef.current = nextFiles;
        setFiles(nextFiles);

        const currentAlbums = albumsRef.current;
        const hasTargetAlbum = Boolean(
          targetAlbumId && currentAlbums.some((album) => album.id === targetAlbumId),
        );
        const forceSingleAlbum =
          !hasTargetAlbum && (parsedUploads.length > 1 || Boolean(importedAlbum));
        let firstSelectedAlbumId: string | null = null;

        if (hasTargetAlbum && targetAlbumId) {
          const uploadedTrackIds = orderedUploads.map((upload) => upload.file.id);
          const nextAlbums = currentAlbums.map((album) =>
            album.id === targetAlbumId
              ? {
                  ...album,
                  trackIds: sortTrackIdsByTrackNumber(
                    asUniqueTrackIds([...album.trackIds, ...uploadedTrackIds]),
                    nextFiles,
                  ),
                }
              : album,
          );
          albumsRef.current = nextAlbums;
          setAlbums(nextAlbums);
          const targetAlbum = nextAlbums.find((album) => album.id === targetAlbumId);
          if (targetAlbum) {
            let taggedFiles = applyAlbumSharedTagsToFiles(filesRef.current, targetAlbum);
            if (settings.syncFilenames) {
              taggedFiles = applySyncedFilenamesToFiles(taggedFiles, targetAlbum.trackIds);
            }
            if (settings.syncTrackNumbers) {
              taggedFiles = applyTrackOrderNumbersToFiles(taggedFiles, nextAlbums, [targetAlbumId]);
            }
            filesRef.current = taggedFiles;
            setFiles(taggedFiles);
          }
          setSelectedFileId(orderedUploads[0].file.id);
          setSelectedAlbumId(targetAlbumId);
        } else if (importedAlbum) {
          let importedCover: AudioMetadata["picture"] | undefined;
          if (importedAlbum.coverUrl) {
            try {
              importedCover = await fetchImportedCover(importedAlbum.coverUrl);
            } catch (error) {
              console.warn("failed to import album cover:", error);
            }
          }
          const embeddedCover = parsedUploads.find((upload) => upload.albumSeed.cover)?.albumSeed
            .cover;
          const downloadedAlbum: AlbumGroup = {
            id: crypto.randomUUID(),
            title: importedAlbum.title,
            artist: importedAlbum.artist,
            genre: importedAlbum.genre,
            cover: importedCover ?? embeddedCover,
            trackIds: orderedUploads.map((upload) => upload.file.id),
            year: importedAlbum.year,
          };
          const nextAlbums = [...currentAlbums, downloadedAlbum];
          albumsRef.current = nextAlbums;
          setAlbums(nextAlbums);
          let taggedFiles = applyAlbumSharedTagsToFiles(filesRef.current, downloadedAlbum);
          if (settings.syncFilenames) {
            taggedFiles = applySyncedFilenamesToFiles(taggedFiles, downloadedAlbum.trackIds);
          }
          if (settings.syncTrackNumbers) {
            taggedFiles = applyTrackOrderNumbersToFiles(taggedFiles, nextAlbums, [
              downloadedAlbum.id,
            ]);
          }
          filesRef.current = taggedFiles;
          setFiles(taggedFiles);
          setSelectedFileId(orderedUploads[0].file.id);
          setSelectedAlbumId(downloadedAlbum.id);
        } else {
          const merged = mergeUploadedTracksIntoAlbums(currentAlbums, orderedUploads, {
            forceSingleAlbum,
            albumSeedUploads: parsedUploads,
            settings,
          });
          firstSelectedAlbumId = merged.firstSelectedAlbumId;
          albumsRef.current = merged.albums;
          setAlbums(merged.albums);
          if (!forceSingleAlbum && merged.unassignedTrackIds.length > 0) {
            setLooseTrackIds((prevLooseTrackIds) =>
              asUniqueTrackIds([...prevLooseTrackIds, ...merged.unassignedTrackIds]),
            );
          }
          let syncedFiles = filesRef.current;
          const uploadedTrackIds = orderedUploads.map((upload) => upload.file.id);
          if (settings.syncFilenames) {
            syncedFiles = applySyncedFilenamesToFiles(syncedFiles, uploadedTrackIds);
          }
          if (merged.albumsToSync.length > 0) {
            syncedFiles = applyTrackOrderNumbersToFiles(
              syncedFiles,
              merged.albums,
              merged.albumsToSync,
            );
          }
          if (syncedFiles !== filesRef.current) {
            filesRef.current = syncedFiles;
            setFiles(syncedFiles);
          }
          const firstUploadedTrack = orderedUploads[0];
          const firstTrackIsLoose = !forceSingleAlbum && !firstUploadedTrack.albumSeed.title.trim();
          setSelectedFileId(firstUploadedTrack.file.id);
          setSelectedAlbumId(firstTrackIsLoose ? null : firstSelectedAlbumId);
        }
      } finally {
        reservedImportKeys.forEach((importKey) => pendingImportKeysRef.current.delete(importKey));
        setLoading(false);
      }
    };

    const queuedImport = importQueueRef.current.then(runImport, runImport);
    importQueueRef.current = queuedImport.catch(() => undefined);
    await queuedImport;
  };
  const replaceFileById = (fileId: string, nextFile: TagiumFile) => {
    const nextFiles = filesRef.current.map((file) => (file.id === fileId ? nextFile : file));
    filesRef.current = nextFiles;
    setFiles(nextFiles);
  };
  const markDownloadError = (fileId: string, error: unknown) => {
    let message = "download failed.";
    if (error instanceof Error) {
      message = error.message;
    }
    const nextFiles = filesRef.current.map((file) =>
      file.id === fileId
        ? {
            ...file,
            status: "error" as const,
            downloadStatus: "error" as const,
            downloadError: message,
          }
        : file,
    );
    filesRef.current = nextFiles;
    setFiles(nextFiles);
  };
  const hydrateDownloadedTrack = async (
    fileId: string,
    downloadedFile: File,
    signal?: AbortSignal,
  ) => {
    signal?.throwIfAborted();
    const [parsedUpload] = await parseUploadedTracks([downloadedFile]);
    signal?.throwIfAborted();
    if (!parsedUpload) {
      throw new Error("downloaded track could not be parsed.");
    }

    const currentFile = filesRef.current.find((file) => file.id === fileId);
    if (!currentFile) return;

    const parsedFile = parsedUpload.file;
    const formMetadata =
      selectedFileIdRef.current === fileId && formDirtyRef.current && currentFile.metadata
        ? getValues()
        : undefined;
    let { hydratedFile, metadataToWrite } = prepareDownloadedTrackHydration(
      currentFile,
      parsedFile,
      formMetadata,
    );

    if (metadataToWrite) {
      try {
        signal?.throwIfAborted();
        const updatedFile = await writeMetadataToFile(hydratedFile, metadataToWrite);
        signal?.throwIfAborted();
        const latestFile = filesRef.current.find((file) => file.id === fileId);
        if (!latestFile) return;
        const latestFormMetadata =
          selectedFileIdRef.current === fileId && formDirtyRef.current ? getValues() : undefined;
        hydratedFile = resolveDownloadedTrackHydrationWrite(
          currentFile,
          latestFile,
          parsedFile,
          hydratedFile,
          updatedFile,
          metadataToWrite,
          latestFormMetadata,
        );
      } catch (error) {
        const latestFile = filesRef.current.find((file) => file.id === fileId);
        if (!latestFile) return;
        let message = "downloaded, but metadata could not be applied.";
        if (error instanceof Error) {
          message = error.message;
        }
        hydratedFile = resolveDownloadedTrackHydrationWriteError(
          currentFile,
          latestFile,
          parsedFile,
          hydratedFile,
          message,
        );
      }
    }

    signal?.throwIfAborted();
    replaceFileById(fileId, hydratedFile);
  };
  const replacePlaylistQueueState = (nextQueue: PlaylistDownloadQueueState) => {
    playlistDownloadQueueRef.current = nextQueue;
    setPlaylistDownloadQueue(nextQueue);
  };
  const updatePlaylistQueueState = (
    queueId: number,
    update: (queue: PlaylistDownloadQueueState) => PlaylistDownloadQueueState,
  ) => {
    setPlaylistDownloadQueue((currentQueue) => {
      if (!currentQueue) return currentQueue;
      if (currentQueue.id !== queueId) return currentQueue;

      const nextQueue = update(currentQueue);
      playlistDownloadQueueRef.current = nextQueue;
      return nextQueue;
    });
  };
  const createPlaylistQueueState = (run: PlaylistDownloadQueueRun): PlaylistDownloadQueueState => {
    return derivePlaylistDownloadQueueState(run, Date.now());
  };
  const publishPlaylistQueueRun = (run: PlaylistDownloadQueueRun) => {
    updatePlaylistQueueState(run.id, () => createPlaylistQueueState(run));
  };
  const clearPlaylistBudgetWake = (run: PlaylistDownloadQueueRun) => {
    if (run.budgetWakeTimeout === undefined) return;

    clearTimeout(run.budgetWakeTimeout);
    run.budgetWakeTimeout = undefined;
  };
  const schedulePlaylistBudgetWake = (run: PlaylistDownloadQueueRun, waitMs: number) => {
    clearPlaylistBudgetWake(run);
    run.budgetWakeTimeout = setTimeout(() => {
      run.budgetWakeTimeout = undefined;
      pumpPlaylistDownloadQueue(run);
    }, waitMs);
  };
  const markDownloadsQueued = (tracks: ManagedDownloadTrack[]) => {
    const trackIds = new Set(tracks.map((track) => track.fileId));
    const nextFiles = filesRef.current.map((file) =>
      trackIds.has(file.id)
        ? {
            ...file,
            status: "pending" as const,
            downloadStatus: "downloading" as const,
            downloadError: undefined,
          }
        : file,
    );
    filesRef.current = nextFiles;
    setFiles(nextFiles);
  };
  const markDownloadsCanceled = (trackIds: string[]) => {
    const trackIdSet = new Set(trackIds);
    const nextFiles = filesRef.current.map((file) =>
      trackIdSet.has(file.id) && file.downloadStatus === "downloading"
        ? {
            ...file,
            downloadStatus: "canceled" as const,
            downloadError: undefined,
          }
        : file,
    );
    filesRef.current = nextFiles;
    setFiles(nextFiles);
  };
  const cancelPendingPlaylistDownloads = (run: PlaylistDownloadQueueRun) => {
    if (run.pending.length === 0) return;

    const canceledTrackIds = cancelPendingPlaylistDownloadTracks(run, Date.now());
    markDownloadsCanceled(canceledTrackIds);
  };
  const cancelActivePlaylistDownloads = (run: PlaylistDownloadQueueRun) => {
    if (run.active.length === 0) return;

    const canceledTrackIds = cancelActivePlaylistDownloadTracks(run, Date.now());
    for (const trackId of canceledTrackIds) {
      run.abortControllers.get(trackId)?.abort(createPlaylistDownloadAbortReason());
    }
    markDownloadsCanceled(canceledTrackIds);
  };
  const finishPlaylistQueueRunIfIdle = (run: PlaylistDownloadQueueRun) => {
    if (!finishPlaylistDownloadQueueRunIfIdle(run)) return false;

    clearPlaylistBudgetWake(run);
    publishPlaylistQueueRun(run);
    return true;
  };
  const startManagedDownload = (run: PlaylistDownloadQueueRun, track: ManagedDownloadTrack) => {
    const startedAt = Date.now();
    const abortController = new AbortController();
    run.abortControllers.set(track.fileId, abortController);
    markPlaylistDownloadTrackActive(run, track, startedAt);
    publishPlaylistQueueRun(run);

    void (async () => {
      try {
        const currentFile = filesRef.current.find((file) => file.id === track.fileId);
        if (!currentFile) {
          markPlaylistDownloadTrackCompleted(run, track.fileId, Date.now());
          return;
        }

        const downloadedFile = await downloadCobaltAudio({
          ...track.downloadRequest,
          signal: abortController.signal,
        });
        abortController.signal.throwIfAborted();
        if (playlistDownloadQueueRunRef.current !== run) return;

        await hydrateDownloadedTrack(track.fileId, downloadedFile, abortController.signal);
        abortController.signal.throwIfAborted();
        if (playlistDownloadQueueRunRef.current !== run) return;

        markPlaylistDownloadTrackCompleted(run, track.fileId, Date.now());
      } catch (error) {
        if (isPlaylistDownloadAbort(error)) {
          markPlaylistDownloadTrackCanceled(run, track.fileId, Date.now());
          if (playlistDownloadQueueRunRef.current === run) {
            markDownloadsCanceled([track.fileId]);
          }
          return;
        }

        let message = "download failed.";
        if (error instanceof Error) {
          message = error.message;
        }
        markPlaylistDownloadTrackFailed(run, track.fileId, message, Date.now());
        if (playlistDownloadQueueRunRef.current === run) {
          markDownloadError(track.fileId, error);
        }
      } finally {
        run.abortControllers.delete(track.fileId);
        removeActivePlaylistDownloadTrack(run, track.fileId);
        publishPlaylistQueueRun(run);
        pumpPlaylistDownloadQueue(run);
      }
    })();
  };
  const pumpPlaylistDownloadQueue = (run: PlaylistDownloadQueueRun) => {
    if (playlistDownloadQueueRunRef.current !== run) return;
    if (run.done) return;

    if (run.canceled) {
      clearPlaylistBudgetWake(run);
      cancelPendingPlaylistDownloads(run);
      cancelActivePlaylistDownloads(run);
      publishPlaylistQueueRun(run);
      finishPlaylistQueueRunIfIdle(run);
      return;
    }

    clearPlaylistBudgetWake(run);
    while (run.active.length < PLAYLIST_DOWNLOAD_CONCURRENCY && run.pending.length > 0) {
      const budget = reserveNextPlaylistDownloadTrack(run, Date.now());

      if (budget.status === "waiting-for-tunnel-budget") {
        schedulePlaylistBudgetWake(run, budget.waitMs);
        publishPlaylistQueueRun(run);
        return;
      }

      if (budget.status === "reserved") {
        startManagedDownload(run, budget.track);
      }
    }

    finishPlaylistQueueRunIfIdle(run);
  };
  const queueDownloadTracks = (tracks: ManagedDownloadTrack[]) => {
    if (tracks.length === 0) return;

    const currentRun = playlistDownloadQueueRunRef.current;
    if (currentRun && !currentRun.done && !currentRun.canceled) {
      const fileErrorTrackIds = new Set(
        filesRef.current.filter((file) => file.status === "error").map((file) => file.id),
      );
      const queuedTracks = enqueuePlaylistDownloadQueueTracks(
        currentRun,
        tracks,
        Date.now(),
        fileErrorTrackIds,
        createPlaylistDownloadModelTrack,
      );
      if (queuedTracks.length === 0) return;

      markDownloadsQueued(queuedTracks);
      publishPlaylistQueueRun(currentRun);
      pumpPlaylistDownloadQueue(currentRun);
      return;
    }

    const run: PlaylistDownloadQueueRun = {
      ...createPlaylistDownloadQueueRun(
        playlistDownloadQueueIdRef.current + 1,
        tracks,
        Date.now(),
        createPlaylistDownloadModelTrack,
      ),
      abortControllers: new Map(),
    };
    playlistDownloadQueueIdRef.current = run.id;
    playlistDownloadQueueRunRef.current = run;
    markDownloadsQueued(tracks);
    replacePlaylistQueueState(createPlaylistQueueState(run));
    pumpPlaylistDownloadQueue(run);
  };
  const managedDownloadTrackFromFile = (file: TagiumFile): ManagedDownloadTrack | null => {
    if (!file.downloadRequest) return null;

    return {
      fileId: file.id,
      title: getManagedDownloadTrackTitle(file),
      downloadRequest: file.downloadRequest,
    };
  };
  const handleAudioDownload = (sourceUrl: string) => {
    bufferCurrentFormMetadata();
    setActiveView("editor");
    const id = crypto.randomUUID();
    const title = titleFromSourceUrl(sourceUrl);
    const pendingFile = createPendingDownloadTrack(
      id,
      createDownloadMetadata({
        title,
        artist: "",
        album: "",
        genre: "",
      }),
      false,
      { sourceUrl, audioBitrate: settings.audioBitrate },
    );
    const nextFiles = [...filesRef.current, pendingFile];
    filesRef.current = nextFiles;
    setFiles(nextFiles);
    setLooseTrackIds((prevLooseTrackIds) => asUniqueTrackIds([...prevLooseTrackIds, id]));
    setSelectedAlbumId(null);
    setSelectedFileId(id);
    setSelectedFileIds(new Set([id]));
    setLastSelectedFileId(id);
    queueDownloadTracks([
      {
        fileId: id,
        title,
        downloadRequest: { sourceUrl, audioBitrate: settings.audioBitrate },
      },
    ]);
  };
  const handleSoundCloudSetDownload = (set: SoundCloudSet) => {
    bufferCurrentFormMetadata();
    setActiveView("editor");
    const albumId = crypto.randomUUID();
    const pendingFiles = set.tracks.map((track) =>
      createPendingDownloadTrack(
        crypto.randomUUID(),
        createDownloadMetadata({
          title: track.title,
          artist: set.artist,
          album: set.title,
          genre: set.genre,
          year: set.year,
          duration: track.duration,
          trackNumber: track.trackNumber,
        }),
        true,
        { sourceUrl: track.url, audioBitrate: settings.audioBitrate },
      ),
    );
    const album: AlbumGroup = {
      id: albumId,
      title: set.title,
      artist: set.artist,
      genre: set.genre,
      trackIds: pendingFiles.map((file) => file.id),
      year: set.year,
    };
    const nextFiles = [...filesRef.current, ...pendingFiles];
    const nextAlbums = [...albumsRef.current, album];
    filesRef.current = nextFiles;
    albumsRef.current = nextAlbums;
    setFiles(nextFiles);
    setAlbums(nextAlbums);
    setSelectedAlbumId(albumId);
    setSelectedFileId(pendingFiles[0]?.id ?? null);
    setSelectedFileIds(new Set(pendingFiles[0] ? [pendingFiles[0].id] : []));
    setLastSelectedFileId(pendingFiles[0]?.id ?? null);

    const coverUrl = set.coverUrl;
    if (coverUrl) {
      void (async () => {
        try {
          const cover = await fetchImportedCover(coverUrl);
          const coveredAlbums = albumsRef.current.map((currentAlbum) =>
            currentAlbum.id === albumId ? { ...currentAlbum, cover } : currentAlbum,
          );
          albumsRef.current = coveredAlbums;
          setAlbums(coveredAlbums);
          const trackIdSet = new Set(album.trackIds);
          const coveredFiles = filesRef.current.map((file) =>
            trackIdSet.has(file.id) && file.file && file.metadata
              ? {
                  ...file,
                  metadata: {
                    ...file.metadata,
                    picture: cover,
                  },
                  status: file.status === "saved" ? "pending" : file.status,
                  hasBufferedChanges: true,
                }
              : file,
          );
          filesRef.current = coveredFiles;
          setFiles(coveredFiles);
          await Promise.all(
            coveredFiles
              .filter((file) => trackIdSet.has(file.id) && Boolean(file.file) && file.metadata)
              .map(async (file) => {
                if (!file.metadata) return;
                try {
                  await handleTagUpdate(file, file.metadata);
                } catch {
                  // handleTagUpdate records the per-track error state.
                }
              }),
          );
        } catch (error) {
          console.warn("failed to import album cover:", error);
        }
      })();
    }

    const tracksToDownload = pendingFiles
      .map((pendingFile) => managedDownloadTrackFromFile(pendingFile))
      .filter((track): track is ManagedDownloadTrack => Boolean(track));
    queueDownloadTracks(tracksToDownload);
  };
  const handleRetryDownload = (fileId: string) => {
    const fileToRetry = filesRef.current.find((file) => file.id === fileId);
    if (!fileToRetry) return;

    const trackToRetry = managedDownloadTrackFromFile(fileToRetry);
    if (!trackToRetry) return;

    queueDownloadTracks([trackToRetry]);
  };
  const handleCancelPlaylistDownloads = () => {
    const currentRun = playlistDownloadQueueRunRef.current;
    if (!currentRun) return;
    if (currentRun.done) return;

    currentRun.canceled = true;
    cancelActivePlaylistDownloads(currentRun);
    publishPlaylistQueueRun(currentRun);
    pumpPlaylistDownloadQueue(currentRun);
  };
  const handleRetryPlaylistDownloads = () => {
    const currentQueue = playlistDownloadQueueRef.current;
    if (!currentQueue) return;
    if (currentQueue.active.length > 0) return;

    const trackIdSet = new Set(currentQueue.trackIds);
    const tracksToRetry = filesRef.current
      .filter((file) => trackIdSet.has(file.id) && !file.file)
      .map((file) => managedDownloadTrackFromFile(file))
      .filter((track): track is ManagedDownloadTrack => Boolean(track));
    queueDownloadTracks(tracksToRetry);
  };
  const handleDownloadAll = async () => {
    if (files.length === 0) return;
    if (!allTracksReadyForDownload(filesRef.current)) return;
    setLoading(true);
    try {
      const syncedFiles = prepareFilesForExport();
      await writeFilesForExport(syncedFiles);

      const entries = getLibraryDownloadEntries({
        albums,
        looseTrackIds,
        files: filesRef.current,
      });
      if (entries.length === 0) return;

      const blob = await createZipBlob(entries);
      downloadBlob(blob, createLibraryDownloadFilename());
    } catch (error) {
      console.error("error downloading all files:", error);
    } finally {
      setLoading(false);
    }
  };
  const handleSettingsChange = (nextSettings: AppSettings) => {
    saveAppSettings(nextSettings);
    setSettings(nextSettings);
    let syncedFiles = filesRef.current;
    if (!settings.syncTrackNumbers && nextSettings.syncTrackNumbers) {
      syncedFiles = applyTrackOrderNumbersToFiles(
        syncedFiles,
        albumsRef.current,
        albumsRef.current.map((album) => album.id),
      );
    }
    if (!settings.syncFilenames && nextSettings.syncFilenames) {
      syncedFiles = applySyncedFilenamesToFiles(syncedFiles);
    }
    if (syncedFiles !== filesRef.current) {
      filesRef.current = syncedFiles;
      setFiles(syncedFiles);
    }
  };
  const handleTrackCoverUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      const uint8Array = new Uint8Array(arrayBuffer);
      setValue(
        "picture",
        [
          {
            format: file.type,
            type: 3,
            data: uint8Array,
            description: "uploaded cover",
          },
        ],
        { shouldDirty: true },
      );
    };
    reader.readAsArrayBuffer(file);
  };
  const handleDownloadAlbum = async (albumId: string) => {
    const album = albumsRef.current.find((a) => a.id === albumId);
    if (!album) return;
    setLoading(true);
    try {
      const syncedFiles = prepareFilesForExport([albumId]);
      const albumFiles = album.trackIds
        .map((id) => syncedFiles.find((file) => file.id === id))
        .filter((file): file is TagiumFile & { file: File; metadata: AudioMetadata } =>
          Boolean(file?.file && file.metadata),
        );
      if (albumFiles.length !== album.trackIds.length) return;
      await writeFilesForExport(albumFiles);

      const entries = getLibraryDownloadEntries({
        albums: [album],
        looseTrackIds: [],
        files: filesRef.current,
        albumRoot: "",
        includeUnassignedFiles: false,
      });
      if (entries.length === 0) return;

      const blob = await createZipBlob(entries);
      const albumFilename = filenamify(album.title, { replacement: "-" });
      if (albumFilename) {
        downloadBlob(blob, `${albumFilename}.zip`);
        return;
      }
      downloadBlob(blob, "album.zip");
    } catch (error) {
      console.error("error downloading album:", error);
    } finally {
      setLoading(false);
    }
  };
  const handleDownloadUpdatedFile: SubmitHandler<AudioMetadata> = async (data) => {
    if (!selectedFile) return;
    const fileId = selectedFile.id;
    const submittedData = getSubmittedMetadata(data);
    try {
      await handleTagUpdate(selectedFile, submittedData);
      const updatedFile = filesRef.current.find((file) => file.id === fileId);
      if (!updatedFile?.file) return;
      downloadBlob(updatedFile.file, updatedFile.filename);
    } catch (error) {
      console.error("failed to update tags before download:", error);
    }
  };
  const handleRemoveFile = (idToRemove: string) => {
    const affectedAlbumIds = albumsRef.current
      .filter((album) => album.trackIds.includes(idToRemove))
      .map((album) => album.id);
    const nextAlbums = removeTrackFromAlbums(albumsRef.current, idToRemove);
    let nextFiles = filesRef.current.filter((file) => file.id !== idToRemove);
    if (settings.syncTrackNumbers && affectedAlbumIds.length > 0) {
      nextFiles = applyTrackOrderNumbersToFiles(nextFiles, nextAlbums, affectedAlbumIds);
    }
    filesRef.current = nextFiles;
    albumsRef.current = nextAlbums;
    setFiles(nextFiles);
    setAlbums(nextAlbums);
    setLooseTrackIds((prevLooseTrackIds) =>
      prevLooseTrackIds.filter((trackId) => trackId !== idToRemove),
    );
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      next.delete(idToRemove);
      return next;
    });
    if (selectedFileId === idToRemove) {
      setSelectedFileId(null);
    }
  };
  const handleRemoveAlbum = (albumId: string) => {
    const albumToRemove = albums.find((album) => album.id === albumId);
    if (!albumToRemove) return;
    const trackIdSet = new Set(albumToRemove.trackIds);
    setFiles((prevFiles) => prevFiles.filter((file) => !trackIdSet.has(file.id)));
    setAlbums((prevAlbums) => prevAlbums.filter((album) => album.id !== albumId));
    setLooseTrackIds((prevLooseTrackIds) =>
      prevLooseTrackIds.filter((trackId) => !trackIdSet.has(trackId)),
    );
    if (editingAlbumId === albumId) {
      closeAlbumDialog();
    }
  };
  const handleSelectAlbum = (albumId: string, event?: ReactMouseEvent) => {
    setActiveView("editor");
    bufferCurrentFormMetadata();
    const isMultiSelect = event?.ctrlKey || event?.metaKey;

    if (isMultiSelect) {
      setSelectedAlbumId(albumId);
      const album = albums.find((entry) => entry.id === albumId);
      const firstTrackId = album?.trackIds[0];
      if (firstTrackId) {
        setSelectedFileIds((prev) => {
          const next = new Set(prev);
          if (next.has(firstTrackId)) {
            next.delete(firstTrackId);
          } else {
            next.add(firstTrackId);
          }
          return next;
        });
        setSelectedFileId(firstTrackId);
        setLastSelectedFileId(firstTrackId);
      }
    } else {
      setSelectedAlbumId(albumId);
      const album = albums.find((entry) => entry.id === albumId);
      const firstTrackId = album?.trackIds[0] ?? null;
      setSelectedFileId(firstTrackId);
      setSelectedFileIds(firstTrackId ? new Set([firstTrackId]) : new Set());
      setLastSelectedFileId(firstTrackId);
    }
  };

  const handleSelectFile = (albumId: string, fileId: string, event?: ReactMouseEvent) => {
    setActiveView("editor");
    bufferCurrentFormMetadata();
    const isMultiSelect = event?.ctrlKey || event?.metaKey;
    const isRangeSelect = event?.shiftKey && lastSelectedFileId;

    if (isRangeSelect) {
      const album = albums.find((entry) => entry.id === albumId);
      if (!album) return;
      const trackIds = album.trackIds;
      const startIndex = trackIds.indexOf(lastSelectedFileId);
      const endIndex = trackIds.indexOf(fileId);
      if (startIndex >= 0 && endIndex >= 0) {
        const minIndex = Math.min(startIndex, endIndex);
        const maxIndex = Math.max(startIndex, endIndex);
        const rangeIds = trackIds.slice(minIndex, maxIndex + 1);
        setSelectedFileIds((prev) => {
          const next = new Set(prev);
          rangeIds.forEach((id) => next.add(id));
          return next;
        });
        setSelectedFileId(fileId);
        setLastSelectedFileId(fileId);
      }
    } else if (isMultiSelect) {
      setSelectedAlbumId(albumId);
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        if (next.has(fileId)) {
          next.delete(fileId);
        } else {
          next.add(fileId);
        }
        return next;
      });
      setSelectedFileId(fileId);
      setLastSelectedFileId(fileId);
    } else {
      setSelectedAlbumId(albumId);
      setSelectedFileId(fileId);
      setSelectedFileIds(new Set([fileId]));
      setLastSelectedFileId(fileId);
    }
  };

  const handleSelectLooseTrack = (fileId: string, event?: ReactMouseEvent) => {
    setActiveView("editor");
    bufferCurrentFormMetadata();
    const isMultiSelect = event?.ctrlKey || event?.metaKey;
    const isRangeSelect = event?.shiftKey && lastSelectedFileId;

    if (isRangeSelect) {
      const startIndex = looseTrackIds.indexOf(lastSelectedFileId);
      const endIndex = looseTrackIds.indexOf(fileId);
      if (startIndex >= 0 && endIndex >= 0) {
        const minIndex = Math.min(startIndex, endIndex);
        const maxIndex = Math.max(startIndex, endIndex);
        const rangeIds = looseTrackIds.slice(minIndex, maxIndex + 1);
        setSelectedFileIds((prev) => {
          const next = new Set(prev);
          rangeIds.forEach((id) => next.add(id));
          return next;
        });
        setSelectedFileId(fileId);
        setLastSelectedFileId(fileId);
      }
    } else if (isMultiSelect) {
      setSelectedAlbumId(null);
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        if (next.has(fileId)) {
          next.delete(fileId);
        } else {
          next.add(fileId);
        }
        return next;
      });
      setSelectedFileId(fileId);
      setLastSelectedFileId(fileId);
    } else {
      setSelectedAlbumId(null);
      setSelectedFileId(fileId);
      setSelectedFileIds(new Set([fileId]));
      setLastSelectedFileId(fileId);
    }
  };

  const handleClearSelection = useCallback(() => {
    setActiveView("editor");
    bufferCurrentFormMetadata();
    setSelectedAlbumId(null);
    setSelectedFileId(null);
    setSelectedFileIds(new Set());
    setLastSelectedFileId(null);
  }, [bufferCurrentFormMetadata]);

  const handleRemoveSelectedFiles = useCallback(() => {
    const idsToRemove = Array.from(selectedFileIds);
    const idSet = new Set(idsToRemove);
    const affectedAlbumIds = albumsRef.current
      .filter((album) => album.trackIds.some((trackId) => idSet.has(trackId)))
      .map((album) => album.id);
    const nextAlbums = idsToRemove.reduce(
      (currentAlbums, fileId) => removeTrackFromAlbums(currentAlbums, fileId),
      albumsRef.current,
    );
    let nextFiles = filesRef.current.filter((file) => !idSet.has(file.id));
    if (settings.syncTrackNumbers && affectedAlbumIds.length > 0) {
      nextFiles = applyTrackOrderNumbersToFiles(nextFiles, nextAlbums, affectedAlbumIds);
    }
    filesRef.current = nextFiles;
    albumsRef.current = nextAlbums;
    setFiles(nextFiles);
    setAlbums(nextAlbums);
    setLooseTrackIds((prevLooseTrackIds) =>
      prevLooseTrackIds.filter((trackId) => !idSet.has(trackId)),
    );
    setSelectedFileIds(new Set());
    setSelectedFileId(null);
    setLastSelectedFileId(null);
  }, [selectedFileIds, settings.syncTrackNumbers]);

  const handleSelectAllFiles = useCallback(() => {
    bufferCurrentFormMetadata();
    const allFileIds = new Set(files.map((file) => file.id));
    setSelectedFileIds(allFileIds);
    if (files.length > 0) {
      setSelectedFileId(files[0].id);
      setLastSelectedFileId(files[0].id);
    }
  }, [files, bufferCurrentFormMetadata]);

  const handleReorderAlbums = (albumId: string, targetIndex: number) => {
    setAlbums((prevAlbums) => reorderAlbums(prevAlbums, albumId, targetIndex));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isModifierPressed = event.ctrlKey || event.metaKey;
      const target = event.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (isInputFocused) {
        return;
      }

      if (isModifierPressed && event.key === "a") {
        event.preventDefault();
        handleSelectAllFiles();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedFileIds.size > 0) {
          event.preventDefault();
          handleRemoveSelectedFiles();
          return;
        }
      }

      if (event.key === "Escape") {
        handleClearSelection();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFileIds, handleSelectAllFiles, handleRemoveSelectedFiles, handleClearSelection]);

  const openCreateAlbumDialog = (seedTrackIds: string[]) => {
    const uniqueSeedTrackIds = asUniqueTrackIds(seedTrackIds);
    const seedTrack = filesRef.current.find((file) => file.id === uniqueSeedTrackIds[0]);
    setAlbumDialogMode("create");
    setEditingAlbumId(null);
    setCreateSeedTrackIds(uniqueSeedTrackIds);
    setAlbumDraft({
      title: "",
      artist: uniqueSeedTrackIds.length > 0 ? seedTrack?.metadata?.artist || "" : "",
      genre: uniqueSeedTrackIds.length > 0 ? toGenreString(seedTrack?.metadata?.genre) : "",
      cover:
        uniqueSeedTrackIds.length > 0 &&
        seedTrack?.metadata?.picture &&
        seedTrack.metadata.picture.length > 0
          ? seedTrack.metadata.picture
          : undefined,
      year: uniqueSeedTrackIds.length > 0 ? (seedTrack?.metadata?.year ?? undefined) : undefined,
    });
    setAlbumDialogOpen(true);
  };
  const handleOpenCreateAlbumDialog = () => {
    bufferCurrentFormMetadata();
    openCreateAlbumDialog([]);
  };
  const handlePromptCreateAlbumFromLooseTracks = (sourceTrackId: string, targetTrackId: string) => {
    if (sourceTrackId === targetTrackId) return;
    bufferCurrentFormMetadata();
    const idSet = new Set([sourceTrackId, targetTrackId]);
    const orderedIds = looseTrackIds.filter((trackId) => idSet.has(trackId));
    if (orderedIds.length < 2) return;
    openCreateAlbumDialog(orderedIds);
  };
  const handleOpenEditAlbumDialog = (albumId: string) => {
    const album = albums.find((entry) => entry.id === albumId);
    if (!album) return;
    setAlbumDialogMode("edit");
    setEditingAlbumId(albumId);
    setCreateSeedTrackIds([]);
    setAlbumDraft({
      title: album.title,
      artist: album.artist,
      genre: album.genre,
      cover: album.cover,
      year: album.year,
    });
    setAlbumDialogOpen(true);
  };
  const closeAlbumDialog = () => {
    setAlbumDialogOpen(false);
  };
  const applyAlbumDraftCoverToTracks = () => {
    if (albumDialogMode !== "edit" || !editingAlbumId || !albumDraft.cover) return;
    if (albumDraft.cover.length === 0) return;

    const album = albumsRef.current.find((entry) => entry.id === editingAlbumId);
    if (!album) return;

    const bufferedFiles = applyCurrentFormMetadataToFiles(filesRef.current, album.trackIds);
    const coveredFiles = applyAlbumCoverToFiles(bufferedFiles, album.trackIds, albumDraft.cover);
    filesRef.current = coveredFiles;
    setFiles(coveredFiles);
  };
  const saveAlbumDialog = () => {
    const title = albumDraft.title.trim() || "untitled album";
    const artist = albumDraft.artist.trim();
    const genre = albumDraft.genre.trim();
    const metadata = {
      title,
      artist,
      genre,
      cover: albumDraft.cover,
      year: albumDraft.year,
    };
    if (albumDialogMode === "edit" && editingAlbumId) {
      const updatedAlbums = updateAlbumMetadata(albums, editingAlbumId, metadata);
      setAlbums(updatedAlbums);
      const updatedAlbum = updatedAlbums.find((album) => album.id === editingAlbumId) ?? null;
      if (updatedAlbum) {
        setFiles((prevFiles) => {
          const taggedFiles = applyAlbumSharedTagsToFiles(prevFiles, updatedAlbum);
          if (settings.syncFilenames) {
            return applySyncedFilenamesToFiles(taggedFiles, updatedAlbum.trackIds);
          }
          return taggedFiles;
        });
      }
      closeAlbumDialog();
      return;
    }
    if (albumDialogMode === "create") {
      const created = createAlbumFromTracks(
        albums,
        looseTrackIds,
        createSeedTrackIds,
        metadata,
        settings,
      );
      setAlbums(created.albums);
      setLooseTrackIds(created.looseTrackIds);
      if (created.syncAlbums.length > 0) {
        setFiles((prevFiles) =>
          applyTrackOrderNumbersToFiles(prevFiles, created.albums, created.syncAlbums),
        );
      }
      if (created.newAlbumId) {
        setSelectedAlbumId(created.newAlbumId);
        setSelectedFileId(createSeedTrackIds[0] ?? null);
        const createdAlbum = created.albums.find((album) => album.id === created.newAlbumId);
        if (createdAlbum) {
          setFiles((prevFiles) => {
            const taggedFiles = applyAlbumSharedTagsToFiles(prevFiles, createdAlbum);
            if (settings.syncFilenames) {
              return applySyncedFilenamesToFiles(taggedFiles, createdAlbum.trackIds);
            }
            return taggedFiles;
          });
        }
      }
    }
    closeAlbumDialog();
  };
  const handleMoveTrackToAlbum = (
    trackId: string,
    targetAlbumId: string,
    placement: "before" | "after" | "append",
    referenceTrackId?: string,
  ) => {
    setActiveView("editor");
    bufferCurrentFormMetadata();
    const moved = moveTrackInSidebar(
      albums,
      looseTrackIds,
      trackId,
      placement === "append" || !referenceTrackId
        ? {
            type: "album",
            albumId: targetAlbumId,
            placement: "append",
          }
        : {
            type: "album",
            albumId: targetAlbumId,
            placement,
            referenceTrackId,
          },
      settings,
    );
    setAlbums(moved.albums);
    setLooseTrackIds(moved.looseTrackIds);
    setSelectedAlbumId(targetAlbumId);
    setSelectedFileId(trackId);
    if (moved.albumsToSync.length > 0) {
      setFiles((prevFiles) =>
        applyTrackOrderNumbersToFiles(prevFiles, moved.albums, moved.albumsToSync),
      );
    }
  };
  const handleMoveTrackToLoose = (
    trackId: string,
    placement: "before" | "after" | "append",
    referenceTrackId?: string,
  ) => {
    setActiveView("editor");
    bufferCurrentFormMetadata();
    const moved = moveTrackInSidebar(
      albums,
      looseTrackIds,
      trackId,
      placement === "append" || !referenceTrackId
        ? {
            type: "loose",
            placement: "append",
          }
        : {
            type: "loose",
            placement,
            referenceTrackId,
          },
      settings,
    );
    setAlbums(moved.albums);
    setLooseTrackIds(moved.looseTrackIds);
    setSelectedAlbumId(null);
    setSelectedFileId(trackId);
    if (moved.albumsToSync.length > 0) {
      setFiles((prevFiles) =>
        applyTrackOrderNumbersToFiles(prevFiles, moved.albums, moved.albumsToSync),
      );
    }
  };

  const libraryIsEmpty = files.length === 0 && albums.length === 0 && looseTrackIds.length === 0;
  const playlistQueueDownloaded = playlistDownloadQueue ? playlistDownloadQueue.completed : 0;
  const playlistQueueEta = playlistDownloadQueue
    ? formatPlaylistQueueEta(playlistDownloadQueue.etaMs)
    : null;
  let playlistQueueRetryCount = 0;
  if (playlistDownloadQueue) {
    const playlistTrackIds = new Set(playlistDownloadQueue.trackIds);
    playlistQueueRetryCount = files.filter(
      (file) => playlistTrackIds.has(file.id) && !file.file && file.downloadRequest,
    ).length;
  }
  const canRetryPlaylistQueue = Boolean(
    playlistDownloadQueue &&
    playlistDownloadQueue.active.length === 0 &&
    playlistQueueRetryCount > 0 &&
    (playlistDownloadQueue.canceled || playlistDownloadQueue.failed > 0),
  );
  let playlistSidebarQueue: PlaylistDownloadQueuePanelState | null = null;
  if (playlistDownloadQueue && playlistDownloadQueue.total > 1) {
    let status: PlaylistDownloadQueuePanelState["status"] = "downloading";
    if (playlistDownloadQueue.waitingForTunnelBudget) {
      status = "waiting";
    }
    if (playlistDownloadQueue.done && playlistDownloadQueue.failed > 0) {
      status = "error";
    }
    if (playlistDownloadQueue.canceled && playlistDownloadQueue.failed === 0) {
      status = "canceled";
    }

    const playlistQueueSettled =
      playlistDownloadQueue.completed +
      playlistDownloadQueue.failed +
      playlistDownloadQueue.canceledCount;

    const nextPlaylistSidebarQueue: PlaylistDownloadQueuePanelState = {
      status,
      downloadedCount: playlistQueueDownloaded,
      totalCount: playlistDownloadQueue.total,
      failedCount: playlistDownloadQueue.failed,
      canceledCount: playlistDownloadQueue.canceledCount,
      currentTracks: playlistDownloadQueue.active.map((track) => ({
        id: track.fileId,
        title: track.title,
      })),
      progress: (playlistQueueSettled / playlistDownloadQueue.total) * 100,
      canCancel: !playlistDownloadQueue.done && !playlistDownloadQueue.canceled,
      canRetry: canRetryPlaylistQueue,
    };
    if (playlistQueueEta) {
      nextPlaylistSidebarQueue.eta = `eta ${playlistQueueEta}`;
    }
    playlistSidebarQueue = nextPlaylistSidebarQueue;
  }

  return (
    <>
      <AlbumMetadataDialog
        open={albumDialogOpen}
        mode={albumDialogMode}
        draft={albumDraft}
        trackCount={
          albumDialogMode === "edit" && editingAlbumId
            ? (albums.find((a) => a.id === editingAlbumId)?.trackIds.length ?? 0)
            : 0
        }
        onChange={setAlbumDraft}
        onClose={closeAlbumDialog}
        onSave={saveAlbumDialog}
        onApplyCover={applyAlbumDraftCoverToTracks}
        onDelete={
          albumDialogMode === "edit" && editingAlbumId
            ? () => {
                handleRemoveAlbum(editingAlbumId);
                closeAlbumDialog();
              }
            : undefined
        }
      />
      <div className="min-h-svh flex flex-col bg-background md:h-svh md:flex-row md:overflow-hidden">
        <TagSidebarPanel
          loading={loading}
          files={files}
          albums={albums}
          looseTrackIds={looseTrackIds}
          selectedAlbumId={selectedAlbumId}
          selectedFileId={selectedFileId}
          selectedFileIds={selectedFileIds}
          settingsOpen={activeView === "settings"}
          onAudioUpload={handleAudioUpload}
          onSelectAlbum={handleSelectAlbum}
          onSelectFile={handleSelectFile}
          onSelectLooseTrack={handleSelectLooseTrack}
          onClearSelection={handleClearSelection}
          onRemoveFile={handleRemoveFile}
          onRetryDownload={handleRetryDownload}
          onAddAlbum={handleOpenCreateAlbumDialog}
          onEditAlbum={handleOpenEditAlbumDialog}
          onDownloadAlbum={handleDownloadAlbum}
          onUploadToAlbum={(albumId, filesToUpload) => handleAudioUpload(filesToUpload, albumId)}
          onMoveTrackToAlbum={handleMoveTrackToAlbum}
          onMoveTrackToLoose={handleMoveTrackToLoose}
          onPromptCreateAlbumFromLooseTracks={handlePromptCreateAlbumFromLooseTracks}
          onReorderAlbums={handleReorderAlbums}
          playlistDownloadQueue={playlistSidebarQueue}
          onDownloadAll={handleDownloadAll}
          onOpenSettings={() => setActiveView("settings")}
          onCancelPlaylistDownloadQueue={handleCancelPlaylistDownloads}
          onRetryPlaylistDownloadQueue={handleRetryPlaylistDownloads}
        />
        <div className="relative order-1 flex-shrink-0 flex flex-col md:order-none md:min-h-0 md:flex-1">
          <div className="h-svh min-h-0 flex flex-col overflow-hidden md:h-auto md:min-h-0 md:flex-1">
            {activeView === "settings" ? (
              <SettingsPage settings={settings} onChange={handleSettingsChange} />
            ) : libraryIsEmpty ? (
              <LandingScreen
                onAudioUpload={handleAudioUpload}
                onAudioDownload={handleAudioDownload}
                onSoundCloudSetDownload={handleSoundCloudSetDownload}
              />
            ) : (
              <TrackMetadataEditor
                selectedFile={selectedFile}
                selectedFileId={selectedFileId}
                register={register}
                control={control}
                handleSubmit={handleSubmit}
                onTrackCoverUpload={handleTrackCoverUpload}
                onDownloadUpdatedFile={handleDownloadUpdatedFile}
                selectedFileAlbum={selectedFileAlbum}
                syncFilenames={settings.syncFilenames}
                syncTrackNumbers={settings.syncTrackNumbers}
              />
            )}
          </div>
          {!libraryIsEmpty && activeView === "editor" && (
            <div className="flex-shrink-0 border-t bg-background/95 p-3 lg:pointer-events-none lg:absolute lg:inset-x-0 lg:bottom-4 lg:z-10 lg:flex lg:justify-center lg:border-t-0 lg:bg-transparent lg:px-4 lg:p-0">
              <div className="pointer-events-auto flex w-full max-w-3xl flex-col gap-2">
                <AudioDownloader
                  onAudioDownload={handleAudioDownload}
                  onSoundCloudSetDownload={handleSoundCloudSetDownload}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
