import { Cause, Effect, Exit } from "effect";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { parseUploads, runAudioBackendEffect, writeTags } from "@/features/audio/audioBackend";
import {
  prepareDownloadedTrackHydration,
  resolveDownloadedTrackHydrationWrite,
  resolveDownloadedTrackHydrationWriteError,
  sanitizePendingMetadataPatch,
} from "@/features/library/fileMetadataOps";
import {
  createDirtyMetadataPatch,
  type DirtyMetadataFields,
  getProjectableAudioMetadata,
  getNullableNumericMetadataValue,
  getNullableNumericPatchValue,
  getSubmittedAudioMetadata,
} from "@/features/editor/audioTaggerUtils";
import { getSystemFailurePresentation } from "@/shared/systemFailure";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type {
  AlbumGroup,
  AppSettings,
  AudioMetadata,
  MetadataPatch,
  TagiumFile,
} from "@/features/library/types";
import { audioFilename, getAudioFormat } from "@/features/audio/audioFormat";
import { EDITABLE_METADATA_FIELDS } from "@/features/audio/metadataFields";
import { sanitizeFilenameBase } from "@/features/library/filename";
import {
  createTrackFilenamePreviewStore,
  type TrackFilenamePreviewStore,
} from "@/features/library/trackFilenamePreview";

type PreviewField = "filename" | "title" | "artist";

const hasOwn = <Value, Key extends PropertyKey>(object: Value, key: Key) =>
  Object.prototype.hasOwnProperty.call(object, key);

const getPendingMetadataPatch = (file: TagiumFile) => file.pendingMetadataPatch;

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
  albumArtist: metadata.albumArtist,
  album: metadata.album,
  year: getNullableNumericPatchValue(metadata.year),
  genre: metadata.genre,
  picture: metadata.picture,
  trackNumber: getNullableNumericPatchValue(metadata.trackNumber),
  discNumber: getNullableNumericPatchValue(metadata.discNumber),
  composer: metadata.composer,
  bpm: getNullableNumericPatchValue(metadata.bpm),
  comment: metadata.comment,
});

const applyMetadataPatch = (metadata: AudioMetadata, patch: MetadataPatch): AudioMetadata => {
  const next = { ...metadata };
  if (patch.filename !== undefined) next.filename = patch.filename;
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.artist !== undefined) next.artist = patch.artist;
  if (patch.albumArtist !== undefined) next.albumArtist = patch.albumArtist;
  if (patch.album !== undefined) next.album = patch.album;
  if (patch.year !== undefined) next.year = getNullableNumericMetadataValue(patch.year);
  if (patch.genre !== undefined) next.genre = patch.genre;
  if (patch.picture !== undefined) next.picture = patch.picture;
  if (patch.trackNumber !== undefined) {
    next.trackNumber = getNullableNumericMetadataValue(patch.trackNumber);
  }
  if (patch.discNumber !== undefined) {
    next.discNumber = getNullableNumericMetadataValue(patch.discNumber);
  }
  if (patch.composer !== undefined) next.composer = patch.composer;
  if (patch.bpm !== undefined) next.bpm = getNullableNumericMetadataValue(patch.bpm);
  if (patch.comment !== undefined) next.comment = patch.comment;
  return next;
};

const getMetadataPatchDifference = (metadata: AudioMetadata, patch?: MetadataPatch) => {
  if (!patch) return undefined;
  const difference = { ...patch };
  for (const field of EDITABLE_METADATA_FIELDS) {
    if (hasOwn(difference, field) && Object.is(metadata[field], difference[field])) {
      delete difference[field];
    }
  }
  return sanitizePendingMetadataPatch(difference);
};

const getFilenameFromPatch = (file: TagiumFile, patch: MetadataPatch) =>
  hasOwn(patch, "filename") && patch.filename
    ? audioFilename(patch.filename, getAudioFormat(file))
    : file.filename;

const withPendingMetadataPatch = (
  file: TagiumFile,
  pendingMetadataPatch: MetadataPatch | undefined,
) => {
  const sanitizedPatch = pendingMetadataPatch
    ? sanitizePendingMetadataPatch(pendingMetadataPatch)
    : undefined;
  return {
    ...file,
    pendingMetadataPatch: sanitizedPatch,
    hasBufferedChanges: Boolean(sanitizedPatch),
  };
};

const withMergedPendingMetadataPatch = (file: TagiumFile, patch: MetadataPatch | undefined) =>
  patch ? withPendingMetadataPatch(file, { ...file.pendingMetadataPatch, ...patch }) : file;

const clearPendingMetadataPatch = (file: TagiumFile) => withPendingMetadataPatch(file, undefined);

export interface TrackEditorSession {
  selectedFile: TagiumFile | null;
  selectedFileAlbum: AlbumGroup | undefined;
  filenamePreviewStore: TrackFilenamePreviewStore;
  isCoverProcessing: boolean;
  form: Pick<
    ReturnType<typeof useForm<AudioMetadata>>,
    | "register"
    | "control"
    | "getValues"
    | "setError"
    | "clearErrors"
    | "setFocus"
    | "reset"
    | "subscribe"
  >;
  commands: {
    projectFiles: (trackIds?: string[]) => TagiumFile[];
    flush: (trackIds?: string[]) => TagiumFile[];
    preview: (field: PreviewField, value: string) => void;
    uploadCover: (
      picture: NonNullable<AudioMetadata["picture"]>,
      sourceFileId?: string | null,
    ) => void;
    setCoverProcessing: (processing: boolean) => void;
    updateTags: (file: TagiumFile, metadata: AudioMetadata) => Promise<void>;
    hydrateDownloadedTrack: (
      fileId: string,
      downloadedFile: File,
    ) => Effect.Effect<void, Error, import("@/features/audio/audioBackend").AudioBackend>;
  };
}

export const useTrackEditorSession = ({
  library,
  settings,
}: {
  library: LibraryStore;
  settings: AppSettings;
}): TrackEditorSession => {
  const settingsRef = useRef(settings);
  const selectedFileIdRef = useRef<string | null>(library.state.selectedFileId);
  const lastResetFileIdRef = useRef<string | null>(null);
  const lastResetMetadataRef = useRef<AudioMetadata | null>(null);
  const formDirtyRef = useRef(false);
  const latestMetadataWritesRef = useRef(new Map<string, symbol>());
  const [filenamePreviewStore] = useState(createTrackFilenamePreviewStore);
  const [isCoverProcessing, setCoverProcessing] = useState(false);
  const {
    register,
    control,
    setValue,
    reset,
    getValues,
    setError,
    clearErrors,
    setFocus,
    subscribe,
    formState: { dirtyFields },
  } = useForm<AudioMetadata>();
  const getLibrarySnapshot = library.getSnapshot;
  const formIsDirty = Object.keys(dirtyFields).length > 0;
  const dirtyFieldsRef = useRef(dirtyFields);
  useLayoutEffect(() => {
    const syncFilenamesChanged = settingsRef.current.syncFilenames !== settings.syncFilenames;
    const selectedId = selectedFileIdRef.current;
    if (
      syncFilenamesChanged &&
      selectedId &&
      (dirtyFieldsRef.current.title || dirtyFieldsRef.current.filename)
    ) {
      const currentFile = getLibrarySnapshot().files.find((file) => file.id === selectedId);
      if (currentFile) {
        const value = settings.syncFilenames ? getValues("title") : getValues("filename");
        const filenameBase = sanitizeFilenameBase(value);
        filenamePreviewStore.set(
          selectedId,
          filenameBase ? audioFilename(filenameBase, getAudioFormat(currentFile)) : undefined,
        );
      }
    }
    settingsRef.current = settings;
    dirtyFieldsRef.current = dirtyFields;
  }, [dirtyFields, filenamePreviewStore, getLibrarySnapshot, getValues, settings]);
  const selectedFile = useMemo(
    () => library.state.files.find((file) => file.id === library.state.selectedFileId) ?? null,
    [library.state.files, library.state.selectedFileId],
  );
  const selectedFileAlbum = useMemo(
    () =>
      selectedFile
        ? library.state.albums.find((album) => album.trackIds.includes(selectedFile.id))
        : undefined,
    [library.state.albums, selectedFile],
  );

  useLayoutEffect(() => {
    const previousSelectedFileId = selectedFileIdRef.current;
    let nextFormIsDirty = formIsDirty;
    if (selectedFile?.metadata) {
      const selectedFileChanged = lastResetFileIdRef.current !== selectedFile.id;
      const selectedMetadataChanged = lastResetMetadataRef.current !== selectedFile.metadata;
      if (selectedFileChanged || !formIsDirty) {
        lastResetFileIdRef.current = selectedFile.id;
        reset(selectedFile.metadata);
        nextFormIsDirty = false;
      } else if (selectedMetadataChanged) {
        reset(selectedFile.metadata, { keepDirtyValues: true });
      }
      lastResetMetadataRef.current = selectedFile.metadata;
    }
    if (previousSelectedFileId && previousSelectedFileId !== library.state.selectedFileId) {
      filenamePreviewStore.set(previousSelectedFileId, undefined);
    }
    selectedFileIdRef.current = library.state.selectedFileId;
    formDirtyRef.current = nextFormIsDirty;
  }, [filenamePreviewStore, formIsDirty, library.state.selectedFileId, reset, selectedFile]);

  const isSingleAlbumLinkedForFile = useCallback(
    (fileId: string | null) => {
      if (!fileId || !settingsRef.current.metadataLinks.singleAlbum) return false;
      return !library.getSnapshot().albums.some((album) => album.trackIds.includes(fileId));
    },
    [library],
  );

  const getSubmittedMetadata = useCallback(
    (data: AudioMetadata, fileId: string | null) =>
      getSubmittedAudioMetadata(
        data,
        settingsRef.current.syncFilenames,
        settingsRef.current.metadataLinks.albumArtist,
        isSingleAlbumLinkedForFile(fileId),
      ),
    [isSingleAlbumLinkedForFile],
  );

  const createCurrentMetadataPatch = useCallback(
    (
      metadata: AudioMetadata,
      dirtyFields: DirtyMetadataFields,
      fileId: string | null,
      extraFields: Iterable<keyof MetadataPatch> = [],
    ) => {
      const fields = new Set(extraFields);
      if (
        settingsRef.current.metadataLinks.albumArtist &&
        (dirtyFields.artist || fields.has("artist"))
      ) {
        fields.add("albumArtist");
      }
      if (isSingleAlbumLinkedForFile(fileId) && (dirtyFields.title || fields.has("title"))) {
        fields.add("album");
      }
      return createDirtyMetadataPatch(
        metadata,
        dirtyFields,
        settingsRef.current.syncFilenames,
        fields,
      );
    },
    [isSingleAlbumLinkedForFile],
  );

  const applyCurrentFormMetadataToFiles = useCallback(
    (files: TagiumFile[], trackIds?: string[]) => {
      const selectedId = selectedFileIdRef.current;
      if (!selectedId || !formDirtyRef.current) return files;
      if (trackIds && !trackIds.includes(selectedId)) return files;

      const currentFile = files.find((file) => file.id === selectedId);
      if (!currentFile) return files;
      const submittedData = getProjectableAudioMetadata(
        getSubmittedMetadata(getValues(), selectedId),
        currentFile.metadata,
        getValues(),
      );
      const metadataPatch = createCurrentMetadataPatch(
        submittedData,
        dirtyFieldsRef.current,
        selectedId,
      );
      if (!metadataPatch) return files;
      return files.map((file) =>
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
    [createCurrentMetadataPatch, getSubmittedMetadata, getValues],
  );

  const projectFiles = useCallback(
    (trackIds?: string[]) => {
      const currentFiles = library.getSnapshot().files;
      return applyCurrentFormMetadataToFiles(currentFiles, trackIds);
    },
    [applyCurrentFormMetadataToFiles, library],
  );

  const flush = useCallback(
    (trackIds?: string[]) => {
      const currentFiles = library.getSnapshot().files;
      const nextFiles = projectFiles(trackIds);
      if (nextFiles !== currentFiles) {
        library.dispatch({ type: "content-replaced", files: nextFiles });
      }
      const selectedId = selectedFileIdRef.current;
      if (selectedId) filenamePreviewStore.set(selectedId, undefined);
      return nextFiles;
    },
    [filenamePreviewStore, library, projectFiles],
  );

  const preview = useCallback(
    (field: PreviewField, value: string) => {
      const selectedId = selectedFileIdRef.current;
      if (!selectedId) return;
      formDirtyRef.current = true;
      dirtyFieldsRef.current = { ...dirtyFieldsRef.current, [field]: true };

      const previewsSyncedTitle = settingsRef.current.syncFilenames && field === "title";
      const previewsFilename = !settingsRef.current.syncFilenames && field === "filename";
      if (!previewsSyncedTitle && !previewsFilename) return;
      const currentFile = library.getSnapshot().files.find((file) => file.id === selectedId);
      if (!currentFile) return;
      const filenameBase = sanitizeFilenameBase(value);
      filenamePreviewStore.set(
        selectedId,
        filenameBase ? audioFilename(filenameBase, getAudioFormat(currentFile)) : undefined,
      );
    },
    [filenamePreviewStore, library],
  );

  const updateTags = useCallback(
    async (fileToUpdate: TagiumFile, newTags: AudioMetadata) => {
      const writeToken = Symbol(fileToUpdate.id);
      latestMetadataWritesRef.current.set(fileToUpdate.id, writeToken);
      const isLatestWrite = () =>
        latestMetadataWritesRef.current.get(fileToUpdate.id) === writeToken;
      const finishWrite = () => {
        if (isLatestWrite()) latestMetadataWritesRef.current.delete(fileToUpdate.id);
      };
      const snapshot = library.getSnapshot();
      const latestFileToUpdate =
        snapshot.files.find((file) => file.id === fileToUpdate.id) ?? fileToUpdate;
      const submittedMetadata = getProjectableAudioMetadata(
        getSubmittedMetadata(newTags, fileToUpdate.id),
        latestFileToUpdate.metadata,
        newTags,
      );
      const metadata = {
        ...submittedMetadata,
        year: getNullableNumericMetadataValue(submittedMetadata.year),
        trackNumber: getNullableNumericMetadataValue(submittedMetadata.trackNumber),
        duration: latestFileToUpdate.metadata?.duration || 0,
        bitrate: latestFileToUpdate.metadata?.bitrate || 0,
        sampleRate: latestFileToUpdate.metadata?.sampleRate || 0,
        picture: submittedMetadata.picture || [],
      };

      if (!latestFileToUpdate.file) {
        const nextFiles = snapshot.files.map((file) =>
          file.id === fileToUpdate.id
            ? withPendingMetadataPatch(
                {
                  ...file,
                  filename: metadata.filename
                    ? audioFilename(metadata.filename, getAudioFormat(file))
                    : file.filename,
                  metadata,
                  status: "pending" as const,
                },
                createSubmittedMetadataPatch(metadata),
              )
            : file,
        );
        library.dispatch({ type: "content-replaced", files: nextFiles });
        if (library.getSnapshot().selectedFileId === fileToUpdate.id) reset(metadata);
        finishWrite();
        return;
      }

      const getLatestUpdateState = () => {
        const latestSnapshot = library.getSnapshot();
        const latestFile = latestSnapshot.files.find((file) => file.id === fileToUpdate.id);
        const latestFormValues =
          latestFile && selectedFileIdRef.current === fileToUpdate.id && formDirtyRef.current
            ? getValues()
            : undefined;
        const latestFormMetadata =
          latestFile?.metadata && latestFormValues
            ? getProjectableAudioMetadata(
                getSubmittedMetadata(latestFormValues, fileToUpdate.id),
                latestFile.metadata,
                latestFormValues,
              )
            : undefined;
        const latestFormPatch = latestFormMetadata
          ? createCurrentMetadataPatch(latestFormMetadata, dirtyFieldsRef.current, fileToUpdate.id)
          : undefined;
        const latestPendingPatch = sanitizePendingMetadataPatch({
          ...latestFile?.pendingMetadataPatch,
          ...latestFormPatch,
        });
        const latestMetadata = latestFile?.metadata
          ? applyMetadataPatch(latestFile.metadata, latestPendingPatch ?? {})
          : undefined;

        return { latestFile, latestMetadata, latestPendingPatch, latestSnapshot };
      };

      try {
        const updatedFile = await runAudioBackendEffect(writeTags(latestFileToUpdate, metadata));
        if (!isLatestWrite()) return;
        const { latestFile, latestMetadata, latestPendingPatch, latestSnapshot } =
          getLatestUpdateState();
        const remainingPatch = getMetadataPatchDifference(metadata, latestPendingPatch);

        if (latestFile && latestMetadata && remainingPatch) {
          const nextFile = withPendingMetadataPatch(
            {
              ...latestFile,
              file: updatedFile,
              originalFile: updatedFile,
              filename: getFilenameFromPatch(latestFile, remainingPatch),
              metadata: latestMetadata,
              status: "pending",
              downloadStatus: "ready",
              downloadError: undefined,
            },
            remainingPatch,
          );
          library.dispatch({
            type: "content-replaced",
            files: latestSnapshot.files.map((file) =>
              file.id === fileToUpdate.id ? nextFile : file,
            ),
          });
          return;
        }

        const nextFiles = latestSnapshot.files.map((file) =>
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
        library.dispatch({ type: "content-replaced", files: nextFiles });
        if (library.getSnapshot().selectedFileId === fileToUpdate.id) reset(metadata);
      } catch (error) {
        if (!isLatestWrite()) throw error;
        const message = getSystemFailurePresentation(error, "metadata").trackDescription;
        const { latestFile, latestMetadata, latestPendingPatch, latestSnapshot } =
          getLatestUpdateState();
        const failedPendingPatch = sanitizePendingMetadataPatch({
          ...createSubmittedMetadataPatch(metadata),
          ...latestPendingPatch,
        });
        const nextFiles = latestSnapshot.files.map((file) =>
          file.id === fileToUpdate.id && latestFile
            ? withPendingMetadataPatch(
                {
                  ...latestFile,
                  status: "error" as const,
                  metadata: {
                    ...(latestMetadata ?? metadata),
                    duration: latestFile.metadata?.duration || 0,
                    bitrate: latestFile.metadata?.bitrate || 0,
                    sampleRate: latestFile.metadata?.sampleRate || 0,
                  },
                  filename: getFilenameFromPatch(latestFile, failedPendingPatch ?? {}),
                  downloadError: message,
                },
                failedPendingPatch,
              )
            : file,
        );
        library.dispatch({ type: "content-replaced", files: nextFiles });
        throw error;
      } finally {
        finishWrite();
      }
    },
    [createCurrentMetadataPatch, getSubmittedMetadata, getValues, library, reset],
  );

  const hydrateDownloadedTrack = useCallback(
    (fileId: string, downloadedFile: File) =>
      Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* Effect.abortSignal;
          yield* Effect.sync(() => signal.throwIfAborted());
          const [parsedUpload] = yield* parseUploads([downloadedFile]);
          yield* Effect.sync(() => signal.throwIfAborted());
          if (!parsedUpload || parsedUpload.file.status === "error") {
            return yield* Effect.fail(new Error("downloaded track could not be parsed."));
          }

          const hydrationState = yield* Effect.sync(() => {
            const currentFile = library.getSnapshot().files.find((file) => file.id === fileId);
            if (!currentFile) return null;
            const parsedFile = parsedUpload.file;
            const formMetadata =
              selectedFileIdRef.current === fileId && formDirtyRef.current && currentFile.metadata
                ? getProjectableAudioMetadata(
                    getSubmittedMetadata(getValues(), fileId),
                    currentFile.metadata,
                    getValues(),
                  )
                : undefined;
            const currentFormPatch = formMetadata
              ? createCurrentMetadataPatch(formMetadata, dirtyFieldsRef.current, fileId)
              : undefined;
            const currentPendingPatch = currentFormPatch
              ? sanitizePendingMetadataPatch({
                  ...getPendingMetadataPatch(currentFile),
                  ...currentFormPatch,
                })
              : getPendingMetadataPatch(currentFile);
            const currentFileWithPendingPatch =
              currentPendingPatch && currentPendingPatch !== currentFile.pendingMetadataPatch
                ? withPendingMetadataPatch(currentFile, currentPendingPatch)
                : currentFile;
            return {
              ...prepareDownloadedTrackHydration(
                currentFileWithPendingPatch,
                parsedFile,
                currentPendingPatch,
              ),
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
              const latestFile = library.getSnapshot().files.find((file) => file.id === fileId);
              if (!latestFile) return null;
              const latestFormMetadata =
                selectedFileIdRef.current === fileId && formDirtyRef.current
                  ? getProjectableAudioMetadata(
                      getSubmittedMetadata(getValues(), fileId),
                      latestFile.metadata,
                      getValues(),
                    )
                  : undefined;
              const latestFormPatch = latestFormMetadata
                ? createCurrentMetadataPatch(latestFormMetadata, dirtyFieldsRef.current, fileId)
                : undefined;
              // Downloaded metadata is authoritative for untouched fields; only replay user edits.
              const latestMetadataForResolve =
                latestFormPatch && hydratedFile.metadata
                  ? applyMetadataPatch(hydratedFile.metadata, latestFormPatch)
                  : latestFormMetadata;
              const latestFileForResolve = latestFormPatch
                ? withMergedPendingMetadataPatch(
                    {
                      ...latestFile,
                      filename: getFilenameFromPatch(latestFile, latestFormPatch),
                      metadata: latestMetadataForResolve,
                    },
                    latestFormPatch,
                  )
                : latestFile;
              if (Exit.isSuccess(writeResult)) {
                return resolveDownloadedTrackHydrationWrite(
                  currentFileWithPendingPatch,
                  latestFileForResolve,
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
                latestFileForResolve,
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
            const nextFile = withPendingMetadataPatch(hydratedFile, hydratedPendingPatch);
            const nextFiles = library
              .getSnapshot()
              .files.map((file) => (file.id === fileId ? nextFile : file));
            library.dispatch({ type: "content-replaced", files: nextFiles });
          });
        }),
      ),
    [createCurrentMetadataPatch, getSubmittedMetadata, getValues, library],
  );

  return {
    selectedFile,
    selectedFileAlbum,
    filenamePreviewStore,
    isCoverProcessing,
    form: { register, control, getValues, setError, clearErrors, setFocus, reset, subscribe },
    commands: {
      projectFiles,
      flush,
      preview,
      uploadCover: (picture, sourceFileId) => {
        if (!sourceFileId || sourceFileId !== selectedFileIdRef.current) return;
        setValue("picture", picture, { shouldDirty: true });
      },
      setCoverProcessing,
      updateTags,
      hydrateDownloadedTrack,
    },
  };
};
