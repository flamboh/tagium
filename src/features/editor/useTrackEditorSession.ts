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
  getProjectableAudioMetadata,
  getNullableNumericMetadataValue,
  getNullableNumericPatchValue,
  getSubmittedAudioMetadata,
} from "@/features/editor/audioTaggerUtils";
import { getSystemFailurePresentation } from "@/features/workspace/systemFailure";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type {
  AlbumGroup,
  AppSettings,
  AudioMetadata,
  MetadataPatch,
  TagiumFile,
} from "@/features/library/types";
import { audioFilename, getAudioFormat } from "@/features/audio/audioFormat";

type PreviewField = "filename" | "title" | "artist";

const hasOwn = <Key extends PropertyKey>(object: object, key: Key) =>
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

const applyMetadataPatch = (metadata: AudioMetadata, patch: MetadataPatch): AudioMetadata => ({
  ...metadata,
  ...(hasOwn(patch, "filename") ? { filename: patch.filename } : {}),
  ...(hasOwn(patch, "title") ? { title: patch.title } : {}),
  ...(hasOwn(patch, "artist") ? { artist: patch.artist } : {}),
  ...(hasOwn(patch, "albumArtist") ? { albumArtist: patch.albumArtist } : {}),
  ...(hasOwn(patch, "album") ? { album: patch.album } : {}),
  ...(hasOwn(patch, "year") ? { year: getNullableNumericMetadataValue(patch.year) } : {}),
  ...(hasOwn(patch, "genre") ? { genre: patch.genre } : {}),
  ...(hasOwn(patch, "picture") ? { picture: patch.picture } : {}),
  ...(hasOwn(patch, "trackNumber")
    ? { trackNumber: getNullableNumericMetadataValue(patch.trackNumber) }
    : {}),
  ...(hasOwn(patch, "discNumber")
    ? { discNumber: getNullableNumericMetadataValue(patch.discNumber) }
    : {}),
  ...(hasOwn(patch, "composer") ? { composer: patch.composer } : {}),
  ...(hasOwn(patch, "bpm") ? { bpm: getNullableNumericMetadataValue(patch.bpm) } : {}),
  ...(hasOwn(patch, "comment") ? { comment: patch.comment } : {}),
});

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
  isCoverProcessing: boolean;
  form: Pick<
    ReturnType<typeof useForm<AudioMetadata>>,
    "register" | "control" | "getValues" | "setError" | "clearErrors" | "setFocus" | "reset"
  >;
  commands: {
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
  const formDirtyRef = useRef(false);
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
    formState: { dirtyFields },
  } = useForm<AudioMetadata>();
  const formIsDirty = Object.keys(dirtyFields).length > 0;
  const dirtyFieldsRef = useRef(dirtyFields);
  useLayoutEffect(() => {
    settingsRef.current = settings;
    dirtyFieldsRef.current = dirtyFields;
  }, [dirtyFields, settings]);
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
    let nextFormIsDirty = formIsDirty;
    if (selectedFile?.metadata) {
      const selectedFileChanged = lastResetFileIdRef.current !== selectedFile.id;
      if (selectedFileChanged || !formIsDirty) {
        lastResetFileIdRef.current = selectedFile.id;
        reset(selectedFile.metadata);
        nextFormIsDirty = false;
      }
    }
    selectedFileIdRef.current = library.state.selectedFileId;
    formDirtyRef.current = nextFormIsDirty;
  }, [formIsDirty, library.state.selectedFileId, reset, selectedFile]);

  const getSubmittedMetadata = useCallback(
    (data: AudioMetadata) =>
      getSubmittedAudioMetadata(
        data,
        settingsRef.current.syncFilenames,
        settingsRef.current.metadataLinks.albumArtist,
      ),
    [],
  );

  const createCurrentMetadataPatch = useCallback(
    (
      metadata: AudioMetadata,
      dirtyFields: Partial<Record<keyof AudioMetadata, unknown>>,
      extraFields: Iterable<keyof MetadataPatch> = [],
    ) => {
      const fields = new Set(extraFields);
      if (
        settingsRef.current.metadataLinks.albumArtist &&
        (dirtyFields.artist || fields.has("artist"))
      ) {
        fields.add("albumArtist");
      }
      return createDirtyMetadataPatch(
        metadata,
        dirtyFields,
        settingsRef.current.syncFilenames,
        fields,
      );
    },
    [],
  );

  const applyCurrentFormMetadataToFiles = useCallback(
    (files: TagiumFile[], trackIds?: string[]) => {
      const selectedId = selectedFileIdRef.current;
      if (!selectedId || !formDirtyRef.current) return files;
      if (trackIds && !trackIds.includes(selectedId)) return files;

      const currentFile = files.find((file) => file.id === selectedId);
      if (!currentFile) return files;
      const submittedData = getProjectableAudioMetadata(
        getSubmittedMetadata(getValues()),
        currentFile.metadata,
        getValues(),
      );
      const metadataPatch = createCurrentMetadataPatch(submittedData, dirtyFieldsRef.current);
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

  const flush = useCallback(
    (trackIds?: string[]) => {
      const currentFiles = library.getSnapshot().files;
      const nextFiles = applyCurrentFormMetadataToFiles(currentFiles, trackIds);
      if (nextFiles !== currentFiles) {
        library.dispatch({ type: "content-replaced", files: nextFiles });
      }
      return nextFiles;
    },
    [applyCurrentFormMetadataToFiles, library],
  );

  const preview = useCallback(
    (field: PreviewField, value: string) => {
      const selectedId = selectedFileIdRef.current;
      if (!selectedId) return;

      formDirtyRef.current = true;
      const currentFiles = library.getSnapshot().files;
      const currentFile = currentFiles.find((file) => file.id === selectedId);
      if (!currentFile) return;
      const formValues = { ...getValues(), [field]: value };
      const submittedData = getProjectableAudioMetadata(
        getSubmittedMetadata(formValues),
        currentFile.metadata,
        formValues,
      );
      const metadataPatch = createCurrentMetadataPatch(submittedData, dirtyFieldsRef.current, [
        field,
      ]);
      if (!metadataPatch) return;
      const nextFiles = currentFiles.map((file) =>
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
      library.dispatch({ type: "content-replaced", files: nextFiles });
    },
    [createCurrentMetadataPatch, getSubmittedMetadata, getValues, library],
  );

  const updateTags = useCallback(
    async (fileToUpdate: TagiumFile, newTags: AudioMetadata) => {
      const snapshot = library.getSnapshot();
      const latestFileToUpdate =
        snapshot.files.find((file) => file.id === fileToUpdate.id) ?? fileToUpdate;
      const submittedMetadata = getProjectableAudioMetadata(
        getSubmittedMetadata(newTags),
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
        return;
      }

      try {
        const updatedFile = await runAudioBackendEffect(writeTags(latestFileToUpdate, metadata));
        const nextFiles = library.getSnapshot().files.map((file) =>
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
        const message = getSystemFailurePresentation(error, "metadata").trackDescription;
        const nextFiles = library.getSnapshot().files.map((file) =>
          file.id === fileToUpdate.id
            ? withPendingMetadataPatch(
                {
                  ...file,
                  status: "error" as const,
                  metadata: {
                    ...metadata,
                    duration: file.metadata?.duration || 0,
                    bitrate: file.metadata?.bitrate || 0,
                    sampleRate: file.metadata?.sampleRate || 0,
                  },
                  filename: metadata.filename
                    ? audioFilename(metadata.filename, getAudioFormat(file))
                    : file.filename,
                  downloadError: message,
                },
                createSubmittedMetadataPatch(metadata),
              )
            : file,
        );
        library.dispatch({ type: "content-replaced", files: nextFiles });
        throw error;
      }
    },
    [getSubmittedMetadata, library, reset],
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
                    getSubmittedMetadata(getValues()),
                    currentFile.metadata,
                    getValues(),
                  )
                : undefined;
            const currentFormPatch = formMetadata
              ? createCurrentMetadataPatch(formMetadata, dirtyFieldsRef.current)
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
                      getSubmittedMetadata(getValues()),
                      latestFile.metadata,
                      getValues(),
                    )
                  : undefined;
              const latestFormPatch = latestFormMetadata
                ? createCurrentMetadataPatch(latestFormMetadata, dirtyFieldsRef.current)
                : undefined;
              const latestMetadataForResolve =
                latestFormPatch && latestFile.metadata
                  ? applyMetadataPatch(latestFile.metadata, latestFormPatch)
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
    isCoverProcessing,
    form: { register, control, getValues, setError, clearErrors, setFocus, reset },
    commands: {
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
