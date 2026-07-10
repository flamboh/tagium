"use client";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { Cause, Effect, Exit } from "effect";
import { SubmitHandler, useForm } from "react-hook-form";
import filenamify from "filenamify";
import AlbumMetadataDialog, { AlbumMetadataDraft } from "./AlbumMetadataDialog";
import DestructiveActionDialog from "./DestructiveActionDialog";
import {
  downloadFromCobalt,
  parseUploads,
  provideAudioBackend,
  runAudioBackendEffect,
  writeTags,
} from "./audioBackend";
import {
  createAlbumFromTracks,
  mergeUploadedTracksIntoAlbums,
  moveTrackInSidebar,
  removeTrackFromAlbums,
  updateAlbumMetadata,
  reorderAlbums,
} from "./albumOps";
import {
  applyAlbumCoverToFilesWithSelectedMetadata,
  applyAlbumSharedTagsToFiles,
  applySyncedFilenamesToFiles,
  applyTrackOrderNumbersToFiles,
  applySoundCloudSetImportedCover,
  areAlbumTrackCoversSynced,
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
  createSingleUrlDownloadPlan,
  createSoundCloudSetDownloadPlan,
  fetchImportedCover,
  type QueuedDownloadTrack,
} from "./downloadTrack";
import {
  createPlaylistDownloadController,
  type PlaylistDownloadController,
  type PlaylistDownloadControllerSnapshot,
} from "./playlistDownloadController";
import LandingScreen from "./LandingScreen";
import TrackMetadataEditor from "./TrackMetadataEditor";
import SettingsPage from "./SettingsPage";
import AudioDownloader from "./AudioDownloader";
import {
  sortTrackIdsByTrackNumber,
  sortUploadedTracksByTrackNumber,
  toGenreString,
} from "./mp3Utils";
import { loadAppSettings, saveAppSettings } from "./settings";
import { getSampleAlbum } from "./sampleMetadata";
import { hasRecoverableSessionWork, useBeforeUnloadProtection } from "./sessionSafety";
import { isSoundCloudSetUrl, resolveSoundCloudSet, type SoundCloudSet } from "./soundcloudSet";
import { getDownloadErrorMessage, notifyDownloadError } from "./downloadErrorMessage";
import {
  AlbumGroup,
  AppSettings,
  AudioMetadata,
  ImportedAlbumMetadata,
  MetadataPatch,
  TagiumFile,
} from "./types";

type ActiveView = "editor" | "settings";
type ManagedDownloadTrack = QueuedDownloadTrack;
type PlaylistDownloadQueueState = PlaylistDownloadControllerSnapshot;

const EMPTY_ALBUM_DRAFT: AlbumMetadataDraft = {
  title: "",
  artist: "",
  genre: "",
  year: undefined,
  cover: undefined,
};
const asUniqueTrackIds = (trackIds: string[]) => [...new Set(trackIds)];
export const getFileImportKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
export const getTagiumFileImportKey = (file: TagiumFile) =>
  file.sourceImportKey ?? (file.originalFile ? getFileImportKey(file.originalFile) : undefined);
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
type MetadataPatchField = keyof MetadataPatch;
type DirtyMetadataFields = Partial<Record<keyof AudioMetadata, unknown>>;

const metadataPatchFields = [
  "filename",
  "title",
  "artist",
  "album",
  "year",
  "genre",
  "picture",
  "trackNumber",
] as const satisfies readonly MetadataPatchField[];
const hasOwn = <Key extends PropertyKey>(object: object, key: Key) =>
  Object.prototype.hasOwnProperty.call(object, key);
const getNullableNumericMetadataValue = (
  value: AudioMetadata["year"] | undefined,
): AudioMetadata["year"] => (value === undefined || Number.isNaN(value) ? null : value);
const getNullableNumericPatchValue = (
  value: AudioMetadata["year"] | undefined,
): MetadataPatch["year"] => (value === undefined || Number.isNaN(value) ? null : value);
const getPendingMetadataPatch = (file: TagiumFile): MetadataPatch | undefined =>
  file.pendingMetadataPatch;
const firstCauseError = (cause: Cause.Cause<unknown>) => {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) return reason.error;
    if (Cause.isDieReason(reason)) return reason.defect;
  }
  return cause;
};
const createSubmittedMetadataPatch = (metadata: AudioMetadata): MetadataPatch => ({
  filename: metadata.filename,
  title: metadata.title,
  artist: metadata.artist,
  album: metadata.album,
  year: getNullableNumericPatchValue(metadata.year),
  genre: metadata.genre,
  picture: metadata.picture,
  trackNumber: getNullableNumericPatchValue(metadata.trackNumber),
});
export const getSubmittedAudioMetadata = (
  data: AudioMetadata,
  syncFilenames: boolean,
): AudioMetadata => ({
  ...data,
  filename: syncFilenames ? filenamify(data.title, { replacement: "-" }) : data.filename,
  year: getNullableNumericMetadataValue(data.year),
  trackNumber: getNullableNumericMetadataValue(data.trackNumber),
});
export const createSparseMetadataPatch = (
  metadata: AudioMetadata,
  fields: Iterable<MetadataPatchField>,
  syncFilenames: boolean,
): MetadataPatch | undefined => {
  const patchFields = new Set(fields);
  if (syncFilenames && patchFields.has("title")) {
    patchFields.add("filename");
  }

  const patch: MetadataPatch = {};
  for (const field of metadataPatchFields) {
    if (!patchFields.has(field)) continue;

    switch (field) {
      case "filename":
        patch.filename = metadata.filename;
        break;
      case "title":
        patch.title = metadata.title;
        break;
      case "artist":
        patch.artist = metadata.artist;
        break;
      case "album":
        patch.album = metadata.album;
        break;
      case "year":
        patch.year = getNullableNumericPatchValue(metadata.year);
        break;
      case "genre":
        patch.genre = metadata.genre;
        break;
      case "picture":
        patch.picture = metadata.picture;
        break;
      case "trackNumber":
        patch.trackNumber = getNullableNumericPatchValue(metadata.trackNumber);
        break;
    }
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
};
export const createDirtyMetadataPatch = (
  metadata: AudioMetadata,
  dirtyFields: DirtyMetadataFields,
  syncFilenames: boolean,
  extraFields: Iterable<MetadataPatchField> = [],
): MetadataPatch | undefined => {
  const fields = new Set<MetadataPatchField>(extraFields);
  for (const field of metadataPatchFields) {
    if (dirtyFields[field]) {
      fields.add(field);
    }
  }

  return createSparseMetadataPatch(metadata, fields, syncFilenames);
};
const applyMetadataPatch = (metadata: AudioMetadata, patch: MetadataPatch): AudioMetadata => ({
  ...metadata,
  ...(hasOwn(patch, "filename") ? { filename: patch.filename } : {}),
  ...(hasOwn(patch, "title") ? { title: patch.title } : {}),
  ...(hasOwn(patch, "artist") ? { artist: patch.artist } : {}),
  ...(hasOwn(patch, "album") ? { album: patch.album } : {}),
  ...(hasOwn(patch, "year") ? { year: getNullableNumericMetadataValue(patch.year) } : {}),
  ...(hasOwn(patch, "genre") ? { genre: patch.genre } : {}),
  ...(hasOwn(patch, "picture") ? { picture: patch.picture } : {}),
  ...(hasOwn(patch, "trackNumber")
    ? { trackNumber: getNullableNumericMetadataValue(patch.trackNumber) }
    : {}),
});
const getFilenameFromPatch = (file: TagiumFile, patch: MetadataPatch) =>
  hasOwn(patch, "filename") && patch.filename ? `${patch.filename}.mp3` : file.filename;
const withPendingMetadataPatch = (
  file: TagiumFile,
  pendingMetadataPatch: MetadataPatch | undefined,
) => ({
  ...file,
  pendingMetadataPatch,
  hasBufferedChanges: Boolean(pendingMetadataPatch),
});
const withMergedPendingMetadataPatch = (file: TagiumFile, patch: MetadataPatch | undefined) =>
  patch ? withPendingMetadataPatch(file, { ...file.pendingMetadataPatch, ...patch }) : file;
const clearPendingMetadataPatch = (file: TagiumFile) => withPendingMetadataPatch(file, undefined);

export default function AudioTagger() {
  const [files, setFiles] = useState<TagiumFile[]>([]);
  const [albums, setAlbums] = useState<AlbumGroup[]>([]);
  const [looseTrackIds, setLooseTrackIds] = useState<string[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [lastSelectedFileId, setLastSelectedFileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [urlImporting, setUrlImporting] = useState(false);
  const [albumDialogOpen, setAlbumDialogOpen] = useState(false);
  const [albumDialogMode, setAlbumDialogMode] = useState<"create" | "edit">("create");
  const [pendingTrackRemoval, setPendingTrackRemoval] = useState<string[] | null>(null);
  const [isTrackCoverProcessing, setIsTrackCoverProcessing] = useState(false);
  const [albumDraft, setAlbumDraft] = useState<AlbumMetadataDraft>(EMPTY_ALBUM_DRAFT);
  const [albumPlaceholderSeed, setAlbumPlaceholderSeed] = useState("new-album");
  const [editingAlbumId, setEditingAlbumId] = useState<string | null>(null);
  const [createSeedTrackIds, setCreateSeedTrackIds] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>("editor");
  const [settings, setSettings] = useState<AppSettings>(loadAppSettings);
  const [playlistDownloadQueue, setPlaylistDownloadQueue] =
    useState<PlaylistDownloadQueueState | null>(null);
  const hasRecoverableWork = hasRecoverableSessionWork({
    fileCount: files.length,
    albumCount: albums.length,
    importing: loading || urlImporting,
  });
  useBeforeUnloadProtection(hasRecoverableWork);
  const filesRef = useRef<TagiumFile[]>(files);
  const albumsRef = useRef<AlbumGroup[]>(albums);
  const selectedFileIdRef = useRef<string | null>(selectedFileId);
  const lastResetFileIdRef = useRef<string | null>(null);
  const formDirtyRef = useRef(false);
  const importQueueRef = useRef(Promise.resolve());
  const pendingImportKeysRef = useRef(new Set<string>());
  const playlistDownloadQueueRef = useRef<PlaylistDownloadQueueState | null>(null);
  const playlistDownloadControllerRef =
    useRef<PlaylistDownloadController<ManagedDownloadTrack> | null>(null);
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
        year: getNullableNumericMetadataValue(newTags.year),
        trackNumber: getNullableNumericMetadataValue(newTags.trackNumber),
        duration: latestFileToUpdate.metadata?.duration || 0,
        bitrate: latestFileToUpdate.metadata?.bitrate || 0,
        sampleRate: latestFileToUpdate.metadata?.sampleRate || 0,
        picture: newTags.picture || [],
      };
      const nextFiles = filesRef.current.map((file) =>
        file.id === fileToUpdate.id
          ? withPendingMetadataPatch(
              {
                ...file,
                filename: newTags.filename ? `${newTags.filename}.mp3` : file.filename,
                metadata,
                status: "pending" as const,
              },
              createSubmittedMetadataPatch(metadata),
            )
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
      const updatedFile = await runAudioBackendEffect(writeTags(latestFileToUpdate, newTags));
      const metadata = {
        ...newTags,
        year: getNullableNumericMetadataValue(newTags.year),
        trackNumber: getNullableNumericMetadataValue(newTags.trackNumber),
        duration: latestFileToUpdate.metadata?.duration || 0,
        bitrate: latestFileToUpdate.metadata?.bitrate || 0,
        sampleRate: latestFileToUpdate.metadata?.sampleRate || 0,
        picture: newTags.picture || [],
      };
      const nextFiles = filesRef.current.map((file) =>
        file.id === fileToUpdate.id
          ? clearPendingMetadataPatch({
              ...file,
              file: updatedFile,
              originalFile: updatedFile,
              filename: updatedFile.name,
              metadata,
              status: "saved" as const,
              downloadStatus: "ready" as const,
              downloadError: undefined,
            })
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
          ? withPendingMetadataPatch(
              {
                ...file,
                status: "error" as const,
                metadata: {
                  ...newTags,
                  year: getNullableNumericMetadataValue(newTags.year),
                  trackNumber: getNullableNumericMetadataValue(newTags.trackNumber),
                  duration: file.metadata?.duration || 0,
                  bitrate: file.metadata?.bitrate || 0,
                  sampleRate: file.metadata?.sampleRate || 0,
                  picture: newTags.picture || [],
                },
                filename: newTags.filename ? `${newTags.filename}.mp3` : file.filename,
                downloadError: message,
              },
              createSubmittedMetadataPatch(newTags),
            )
          : file,
      );
      filesRef.current = nextFiles;
      setFiles(nextFiles);
      throw error;
    }
  };
  const getSubmittedMetadata = useCallback(
    (data: AudioMetadata) => getSubmittedAudioMetadata(data, settings.syncFilenames),
    [settings.syncFilenames],
  );

  const applyCurrentFormMetadataToFiles = useCallback(
    (filesToSync: TagiumFile[], trackIds?: string[]) => {
      const selectedId = selectedFileIdRef.current;
      if (!selectedId || !formDirtyRef.current) return filesToSync;
      if (trackIds && !trackIds.includes(selectedId)) return filesToSync;

      const submittedData = getSubmittedMetadata(getValues());
      const metadataPatch = createDirtyMetadataPatch(
        submittedData,
        dirtyFields,
        settings.syncFilenames,
      );
      if (!metadataPatch) return filesToSync;
      return filesToSync.map((file) =>
        file.id === selectedId
          ? withMergedPendingMetadataPatch(
              {
                ...file,
                filename: getFilenameFromPatch(file, metadataPatch),
                metadata: file.metadata
                  ? applyMetadataPatch(file.metadata, metadataPatch)
                  : submittedData,
                status: file.status === "saved" ? "pending" : file.status,
              },
              metadataPatch,
            )
          : file,
      );
    },
    [dirtyFields, getSubmittedMetadata, getValues, settings.syncFilenames],
  );

  const handlePreviewMetadataChange = useCallback(
    (field: "filename" | "title", value: string) => {
      const selectedId = selectedFileIdRef.current;
      if (!selectedId) return;

      formDirtyRef.current = true;
      const submittedData = getSubmittedMetadata({
        ...getValues(),
        [field]: value,
      });
      const metadataPatch = createDirtyMetadataPatch(
        submittedData,
        dirtyFields,
        settings.syncFilenames,
        [field],
      );
      if (!metadataPatch) return;
      const nextFiles = filesRef.current.map((file) =>
        file.id === selectedId
          ? withMergedPendingMetadataPatch(
              {
                ...file,
                filename: getFilenameFromPatch(file, metadataPatch),
                metadata: file.metadata
                  ? applyMetadataPatch(file.metadata, metadataPatch)
                  : submittedData,
                status: file.status === "saved" ? "pending" : file.status,
              },
              metadataPatch,
            )
          : file,
      );
      filesRef.current = nextFiles;
      setFiles(nextFiles);
    },
    [dirtyFields, getSubmittedMetadata, getValues, settings.syncFilenames],
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
          .map(getTagiumFileImportKey)
          .filter((importKey): importKey is string => Boolean(importKey)),
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
        const parsedUploads = await runAudioBackendEffect(parseUploads(uniqueUploadedFiles));
        if (parsedUploads.length === 0) return;
        const orderedUploads = sortUploadedTracksByTrackNumber(parsedUploads);

        const nextFiles = [
          ...filesRef.current,
          ...orderedUploads.map((upload) => ({
            ...upload.file,
            sourceImportKey: upload.file.originalFile
              ? getFileImportKey(upload.file.originalFile)
              : undefined,
          })),
        ];
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
      message = getDownloadErrorMessage(error);
      notifyDownloadError(error);
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
  const hydrateDownloadedTrack = (fileId: string, downloadedFile: File) =>
    Effect.scoped(
      Effect.gen(function* () {
        const signal = yield* Effect.abortSignal;
        yield* Effect.sync(() => signal.throwIfAborted());
        const [parsedUpload] = yield* parseUploads([downloadedFile]);
        yield* Effect.sync(() => signal.throwIfAborted());
        if (!parsedUpload) {
          return yield* Effect.fail(new Error("downloaded track could not be parsed."));
        }

        const hydrationState = yield* Effect.sync(() => {
          const currentFile = filesRef.current.find((file) => file.id === fileId);
          if (!currentFile) return null;

          const parsedFile = parsedUpload.file;
          const formMetadata =
            selectedFileIdRef.current === fileId && formDirtyRef.current && currentFile.metadata
              ? getSubmittedMetadata(getValues())
              : undefined;
          const currentPendingPatch = formMetadata
            ? createDirtyMetadataPatch(formMetadata, dirtyFields, settings.syncFilenames)
            : getPendingMetadataPatch(currentFile);
          const currentFileWithPendingPatch = currentPendingPatch
            ? withPendingMetadataPatch(currentFile, currentPendingPatch)
            : currentFile;
          const hydration = prepareDownloadedTrackHydration(
            currentFileWithPendingPatch,
            parsedFile,
            currentPendingPatch,
          );

          return {
            ...hydration,
            currentFileWithPendingPatch,
            parsedFile,
          };
        });
        if (!hydrationState) return;

        let { hydratedFile } = hydrationState;
        const { currentFileWithPendingPatch, metadataToWrite, parsedFile } = hydrationState;

        if (metadataToWrite) {
          const writeResult = yield* writeTags(hydratedFile, metadataToWrite).pipe(Effect.exit);
          yield* Effect.sync(() => signal.throwIfAborted());
          const nextHydratedFile = yield* Effect.sync(() => {
            const latestFile = filesRef.current.find((file) => file.id === fileId);
            if (!latestFile) return null;

            if (Exit.isSuccess(writeResult)) {
              const latestFormMetadata =
                selectedFileIdRef.current === fileId && formDirtyRef.current
                  ? getSubmittedMetadata(getValues())
                  : undefined;
              const latestFormPatch = latestFormMetadata
                ? createDirtyMetadataPatch(latestFormMetadata, dirtyFields, settings.syncFilenames)
                : undefined;
              const latestMetadataForResolve =
                latestFormPatch && latestFile.metadata
                  ? applyMetadataPatch(latestFile.metadata, latestFormPatch)
                  : latestFormMetadata;
              return resolveDownloadedTrackHydrationWrite(
                currentFileWithPendingPatch,
                latestFormPatch
                  ? withMergedPendingMetadataPatch(latestFile, latestFormPatch)
                  : latestFile,
                parsedFile,
                hydratedFile,
                writeResult.value,
                metadataToWrite,
                latestMetadataForResolve,
              );
            }

            const error = firstCauseError(writeResult.cause);
            const message =
              error instanceof Error
                ? error.message
                : "downloaded, but metadata could not be applied.";
            return resolveDownloadedTrackHydrationWriteError(
              currentFileWithPendingPatch,
              latestFile,
              parsedFile,
              hydratedFile,
              message,
            );
          });
          if (!nextHydratedFile) return;
          hydratedFile = nextHydratedFile;
        }

        yield* Effect.sync(() => signal.throwIfAborted());
        yield* Effect.sync(() => {
          const hydratedPendingPatch =
            metadataToWrite && hydratedFile.status !== "saved"
              ? (getPendingMetadataPatch(hydratedFile) ??
                (hydratedFile.metadata
                  ? createSubmittedMetadataPatch(hydratedFile.metadata)
                  : metadataToWrite))
              : undefined;
          replaceFileById(fileId, withPendingMetadataPatch(hydratedFile, hydratedPendingPatch));
        });
      }),
    );
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
  const getPlaylistDownloadController = () => {
    if (playlistDownloadControllerRef.current) return playlistDownloadControllerRef.current;

    const controller = createPlaylistDownloadController<ManagedDownloadTrack>({
      createModelTrack: createPlaylistDownloadModelTrack,
      downloadTrack: (track) => provideAudioBackend(downloadFromCobalt(track.downloadRequest)),
      hydrateTrack: (track, downloadedFile) =>
        provideAudioBackend(hydrateDownloadedTrack(track.fileId, downloadedFile)),
      hasTrack: (trackId) => filesRef.current.some((file) => file.id === trackId),
      getFileErrorTrackIds: () =>
        new Set(filesRef.current.filter((file) => file.status === "error").map((file) => file.id)),
      markQueued: markDownloadsQueued,
      markCanceled: markDownloadsCanceled,
      markFailed: markDownloadError,
      emitSnapshot: (snapshot) => {
        playlistDownloadQueueRef.current = snapshot;
        setPlaylistDownloadQueue(snapshot);
      },
    });
    playlistDownloadControllerRef.current = controller;
    return controller;
  };
  const queueDownloadTracks = (tracks: ManagedDownloadTrack[]) => {
    if (tracks.length === 0) return;
    getPlaylistDownloadController().enqueue(tracks);
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
    const plan = createSingleUrlDownloadPlan({
      sourceUrl,
      audioBitrate: settings.audioBitrate,
      createId: () => crypto.randomUUID(),
    });
    const nextFiles = [...filesRef.current, ...plan.pendingFiles];
    filesRef.current = nextFiles;
    setFiles(nextFiles);
    setLooseTrackIds((prevLooseTrackIds) =>
      asUniqueTrackIds([...prevLooseTrackIds, ...plan.looseTrackIds]),
    );
    setSelectedAlbumId(plan.selection.selectedAlbumId);
    setSelectedFileId(plan.selection.selectedFileId);
    setSelectedFileIds(plan.selection.selectedFileIds);
    setLastSelectedFileId(plan.selection.lastSelectedFileId);
    queueDownloadTracks(plan.queuedTracks);
  };
  const handleSoundCloudSetDownload = (set: SoundCloudSet) => {
    bufferCurrentFormMetadata();
    setActiveView("editor");
    const plan = createSoundCloudSetDownloadPlan({
      set,
      audioBitrate: settings.audioBitrate,
      createId: () => crypto.randomUUID(),
    });
    const nextFiles = [...filesRef.current, ...plan.pendingFiles];
    const nextAlbums = [...albumsRef.current, plan.album];
    filesRef.current = nextFiles;
    albumsRef.current = nextAlbums;
    setFiles(nextFiles);
    setAlbums(nextAlbums);
    setSelectedAlbumId(plan.selection.selectedAlbumId);
    setSelectedFileId(plan.selection.selectedFileId);
    setSelectedFileIds(plan.selection.selectedFileIds);
    setLastSelectedFileId(plan.selection.lastSelectedFileId);

    const coverImport = plan.coverImport;
    if (coverImport) {
      void (async () => {
        try {
          const cover = await fetchImportedCover(coverImport.coverUrl);
          const {
            albums: coveredAlbums,
            files: coveredFiles,
            selectedMetadata,
          } = applySoundCloudSetImportedCover(
            filesRef.current,
            albumsRef.current,
            coverImport.albumId,
            coverImport.trackIds,
            coverImport.set,
            settings,
            cover,
            selectedFileIdRef.current,
          );
          albumsRef.current = coveredAlbums;
          setAlbums(coveredAlbums);
          if (coveredFiles === filesRef.current) return;

          filesRef.current = coveredFiles;
          setFiles(coveredFiles);
          if (selectedMetadata) {
            reset(selectedMetadata);
          }
          const trackIdSet = new Set(coverImport.trackIds);
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

    queueDownloadTracks(plan.queuedTracks);
  };
  const handleUrlImport = async (sourceUrl: string) => {
    const trimmedUrl = sourceUrl.trim();
    if (!trimmedUrl) return;

    setUrlImporting(true);
    try {
      if (isSoundCloudSetUrl(trimmedUrl)) {
        const set = await resolveSoundCloudSet(trimmedUrl);
        handleSoundCloudSetDownload(set);
        return;
      }

      handleAudioDownload(trimmedUrl);
    } finally {
      setUrlImporting(false);
    }
  };
  const handleRetryDownload = (fileId: string) => {
    const fileToRetry = filesRef.current.find((file) => file.id === fileId);
    if (!fileToRetry) return;

    const trackToRetry = managedDownloadTrackFromFile(fileToRetry);
    if (!trackToRetry) return;

    queueDownloadTracks([trackToRetry]);
  };
  const handleCancelPlaylistDownloads = () => {
    getPlaylistDownloadController().cancel();
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
    getPlaylistDownloadController().retry(tracksToRetry);
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
  const handleTrackCoverUpload = (
    picture: NonNullable<AudioMetadata["picture"]>,
    sourceFileId?: string | null,
  ) => {
    if (!sourceFileId || sourceFileId !== selectedFileIdRef.current) return;
    setValue("picture", picture, { shouldDirty: true });
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
  const removeFiles = useCallback(
    (idsToRemove: string[]) => {
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
      setSelectedFileIds((prev) => {
        return new Set(Array.from(prev).filter((fileId) => !idSet.has(fileId)));
      });
      setSelectedFileId((currentFileId) =>
        currentFileId && idSet.has(currentFileId) ? null : currentFileId,
      );
      setLastSelectedFileId((currentFileId) =>
        currentFileId && idSet.has(currentFileId) ? null : currentFileId,
      );
    },
    [settings.syncTrackNumbers],
  );
  const requestRemoveFile = (idToRemove: string) => {
    if (isTrackCoverProcessing) return;
    setPendingTrackRemoval([idToRemove]);
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
    if (isTrackCoverProcessing) return;
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
    if (isTrackCoverProcessing) return;
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
    if (isTrackCoverProcessing) return;
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
    if (isTrackCoverProcessing) return;
    setActiveView("editor");
    bufferCurrentFormMetadata();
    setSelectedAlbumId(null);
    setSelectedFileId(null);
    setSelectedFileIds(new Set());
    setLastSelectedFileId(null);
  }, [bufferCurrentFormMetadata, isTrackCoverProcessing]);

  const requestRemoveSelectedFiles = useCallback(() => {
    if (isTrackCoverProcessing) return;
    if (selectedFileIds.size === 0) return;
    setPendingTrackRemoval(Array.from(selectedFileIds));
  }, [isTrackCoverProcessing, selectedFileIds]);

  const handleSelectAllFiles = useCallback(() => {
    if (isTrackCoverProcessing) return;
    bufferCurrentFormMetadata();
    const allFileIds = new Set(files.map((file) => file.id));
    setSelectedFileIds(allFileIds);
    if (files.length > 0) {
      setSelectedFileId(files[0].id);
      setLastSelectedFileId(files[0].id);
    }
  }, [files, bufferCurrentFormMetadata, isTrackCoverProcessing]);

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
          requestRemoveSelectedFiles();
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
  }, [selectedFileIds, handleSelectAllFiles, requestRemoveSelectedFiles, handleClearSelection]);

  const openCreateAlbumDialog = (seedTrackIds: string[]) => {
    const uniqueSeedTrackIds = asUniqueTrackIds(seedTrackIds);
    const seedTrack = filesRef.current.find((file) => file.id === uniqueSeedTrackIds[0]);
    setAlbumDialogMode("create");
    setEditingAlbumId(null);
    setCreateSeedTrackIds(uniqueSeedTrackIds);
    setAlbumPlaceholderSeed(uniqueSeedTrackIds[0] ?? crypto.randomUUID());
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
    setAlbumPlaceholderSeed(albumId);
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
  const syncAlbumDraftCoverToTracks = () => {
    if (albumDialogMode !== "edit" || !editingAlbumId || !albumDraft.cover) return;
    if (albumDraft.cover.length === 0) return;

    const album = albumsRef.current.find((entry) => entry.id === editingAlbumId);
    if (!album) return;

    const bufferedFiles = applyCurrentFormMetadataToFiles(filesRef.current, album.trackIds);
    const covered = applyAlbumCoverToFilesWithSelectedMetadata(
      bufferedFiles,
      album.trackIds,
      albumDraft.cover,
      selectedFileIdRef.current,
    );
    const coveredFiles = covered.files;
    filesRef.current = coveredFiles;
    setFiles(coveredFiles);
    if (covered.selectedMetadata) {
      reset(covered.selectedMetadata);
    }
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
      const currentAlbum = albumsRef.current.find((album) => album.id === editingAlbumId);
      const updatedAlbums = updateAlbumMetadata(albumsRef.current, editingAlbumId, metadata);
      albumsRef.current = updatedAlbums;
      setAlbums(updatedAlbums);
      const updatedAlbum = updatedAlbums.find((album) => album.id === editingAlbumId) ?? null;
      if (updatedAlbum) {
        const bufferedFiles = applyCurrentFormMetadataToFiles(
          filesRef.current,
          updatedAlbum.trackIds,
        );
        const shouldSyncCover =
          Boolean(updatedAlbum.cover && updatedAlbum.cover.length > 0) &&
          areAlbumTrackCoversSynced(bufferedFiles, updatedAlbum.trackIds, currentAlbum?.cover);
        let taggedFiles = applyAlbumSharedTagsToFiles(bufferedFiles, updatedAlbum);

        if (settings.syncFilenames) {
          taggedFiles = applySyncedFilenamesToFiles(taggedFiles, updatedAlbum.trackIds);
        }

        if (shouldSyncCover && updatedAlbum.cover) {
          const covered = applyAlbumCoverToFilesWithSelectedMetadata(
            taggedFiles,
            updatedAlbum.trackIds,
            updatedAlbum.cover,
            selectedFileIdRef.current,
          );
          taggedFiles = covered.files;
          if (covered.selectedMetadata) {
            reset(covered.selectedMetadata);
          }
        }

        filesRef.current = taggedFiles;
        setFiles(taggedFiles);
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
    if (isTrackCoverProcessing) return;
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
    if (isTrackCoverProcessing) return;
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
      <DestructiveActionDialog
        open={pendingTrackRemoval !== null}
        itemCount={pendingTrackRemoval?.length ?? 0}
        onCancel={() => setPendingTrackRemoval(null)}
        onConfirm={() => {
          const trackIds = pendingTrackRemoval;
          setPendingTrackRemoval(null);
          if (trackIds) removeFiles(trackIds);
        }}
      />
      <AlbumMetadataDialog
        open={albumDialogOpen}
        mode={albumDialogMode}
        draft={albumDraft}
        placeholder={getSampleAlbum(albumPlaceholderSeed)}
        trackCount={
          albumDialogMode === "edit" && editingAlbumId
            ? (albums.find((a) => a.id === editingAlbumId)?.trackIds.length ?? 0)
            : 0
        }
        onChange={setAlbumDraft}
        onClose={closeAlbumDialog}
        onSave={saveAlbumDialog}
        onSyncCoverToTracks={syncAlbumDraftCoverToTracks}
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
          onRemoveFile={requestRemoveFile}
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
          onOpenSettings={() => {
            if (isTrackCoverProcessing) return;
            setActiveView((currentView) => (currentView === "settings" ? "editor" : "settings"));
          }}
          onCancelPlaylistDownloadQueue={handleCancelPlaylistDownloads}
          onRetryPlaylistDownloadQueue={handleRetryPlaylistDownloads}
        />
        <div className="relative order-1 flex-shrink-0 flex flex-col md:order-none md:min-h-0 md:flex-1">
          <div className="h-svh min-h-0 flex flex-col overflow-hidden md:h-auto md:min-h-0 md:flex-1">
            {activeView === "settings" ? (
              <SettingsPage
                settings={settings}
                onChange={handleSettingsChange}
                onBack={() => setActiveView("editor")}
              />
            ) : libraryIsEmpty ? (
              <LandingScreen onAudioUpload={handleAudioUpload} onUrlImport={handleUrlImport} />
            ) : (
              <TrackMetadataEditor
                selectedFile={selectedFile}
                selectedFileId={selectedFileId}
                register={register}
                control={control}
                handleSubmit={handleSubmit}
                onTrackCoverUpload={handleTrackCoverUpload}
                onTrackCoverProcessingChange={setIsTrackCoverProcessing}
                isTrackCoverProcessing={isTrackCoverProcessing}
                onDownloadUpdatedFile={handleDownloadUpdatedFile}
                selectedFileAlbum={selectedFileAlbum}
                syncFilenames={settings.syncFilenames}
                syncTrackNumbers={settings.syncTrackNumbers}
                onPreviewMetadataChange={(field, event) =>
                  handlePreviewMetadataChange(field, event.target.value)
                }
              />
            )}
          </div>
          {!libraryIsEmpty && activeView === "editor" && (
            <div className="flex-shrink-0 border-t bg-background/95 p-3 lg:pointer-events-none lg:absolute lg:inset-x-0 lg:bottom-4 lg:z-10 lg:flex lg:justify-center lg:border-t-0 lg:bg-transparent lg:px-4 lg:p-0">
              <div className="pointer-events-auto flex w-full max-w-3xl flex-col gap-2">
                <AudioDownloader onUrlImport={handleUrlImport} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
