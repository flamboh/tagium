import { Cause, Effect, Exit } from "effect";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { parseUploads, runAudioBackendEffect, writeTags } from "@/features/audio/audioBackend";
import {
  prepareDownloadedTrackHydration,
  resolveDownloadedTrackHydrationWrite,
  resolveDownloadedTrackHydrationWriteError,
} from "@/features/library/fileMetadataOps";
import {
  createDirtyMetadataPatch,
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
  album: metadata.album,
  year: getNullableNumericPatchValue(metadata.year),
  genre: metadata.genre,
  picture: metadata.picture,
  trackNumber: getNullableNumericPatchValue(metadata.trackNumber),
});

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
  hasOwn(patch, "filename") && patch.filename
    ? audioFilename(patch.filename, getAudioFormat(file))
    : file.filename;

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

export interface TrackEditorSession {
  selectedFile: TagiumFile | null;
  selectedFileAlbum: AlbumGroup | undefined;
  isCoverProcessing: boolean;
  form: Pick<
    ReturnType<typeof useForm<AudioMetadata>>,
    "register" | "control" | "handleSubmit" | "reset"
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
    handleSubmit,
    control,
    setValue,
    reset,
    getValues,
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
    (data: AudioMetadata) => getSubmittedAudioMetadata(data, settingsRef.current.syncFilenames),
    [],
  );

  const applyCurrentFormMetadataToFiles = useCallback(
    (files: TagiumFile[], trackIds?: string[]) => {
      const selectedId = selectedFileIdRef.current;
      if (!selectedId || !formDirtyRef.current) return files;
      if (trackIds && !trackIds.includes(selectedId)) return files;

      const submittedData = getSubmittedMetadata(getValues());
      const metadataPatch = createDirtyMetadataPatch(
        submittedData,
        dirtyFieldsRef.current,
        settingsRef.current.syncFilenames,
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
    [getSubmittedMetadata, getValues],
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
      const submittedData = getSubmittedMetadata({ ...getValues(), [field]: value });
      const metadataPatch = createDirtyMetadataPatch(
        submittedData,
        dirtyFieldsRef.current,
        settingsRef.current.syncFilenames,
        [field],
      );
      if (!metadataPatch) return;
      const nextFiles = library.getSnapshot().files.map((file) =>
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
    [getSubmittedMetadata, getValues, library],
  );

  const updateTags = useCallback(
    async (fileToUpdate: TagiumFile, newTags: AudioMetadata) => {
      const snapshot = library.getSnapshot();
      const latestFileToUpdate =
        snapshot.files.find((file) => file.id === fileToUpdate.id) ?? fileToUpdate;
      const metadata = {
        ...newTags,
        year: getNullableNumericMetadataValue(newTags.year),
        trackNumber: getNullableNumericMetadataValue(newTags.trackNumber),
        duration: latestFileToUpdate.metadata?.duration || 0,
        bitrate: latestFileToUpdate.metadata?.bitrate || 0,
        sampleRate: latestFileToUpdate.metadata?.sampleRate || 0,
        picture: newTags.picture || [],
      };

      if (!latestFileToUpdate.file) {
        const nextFiles = snapshot.files.map((file) =>
          file.id === fileToUpdate.id
            ? withPendingMetadataPatch(
                {
                  ...file,
                  filename: newTags.filename
                    ? audioFilename(newTags.filename, getAudioFormat(file))
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
        const updatedFile = await runAudioBackendEffect(writeTags(latestFileToUpdate, newTags));
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
                  filename: newTags.filename
                    ? audioFilename(newTags.filename, getAudioFormat(file))
                    : file.filename,
                  downloadError: message,
                },
                createSubmittedMetadataPatch(newTags),
              )
            : file,
        );
        library.dispatch({ type: "content-replaced", files: nextFiles });
        throw error;
      }
    },
    [library, reset],
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
                ? getSubmittedMetadata(getValues())
                : undefined;
            const currentPendingPatch = formMetadata
              ? createDirtyMetadataPatch(
                  formMetadata,
                  dirtyFieldsRef.current,
                  settingsRef.current.syncFilenames,
                )
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
              if (Exit.isSuccess(writeResult)) {
                const latestFormMetadata =
                  selectedFileIdRef.current === fileId && formDirtyRef.current
                    ? getSubmittedMetadata(getValues())
                    : undefined;
                const latestFormPatch = latestFormMetadata
                  ? createDirtyMetadataPatch(
                      latestFormMetadata,
                      dirtyFieldsRef.current,
                      settingsRef.current.syncFilenames,
                    )
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
            const nextFile = withPendingMetadataPatch(hydratedFile, hydratedPendingPatch);
            const nextFiles = library
              .getSnapshot()
              .files.map((file) => (file.id === fileId ? nextFile : file));
            library.dispatch({ type: "content-replaced", files: nextFiles });
          });
        }),
      ),
    [getSubmittedMetadata, getValues, library],
  );

  return {
    selectedFile,
    selectedFileAlbum,
    isCoverProcessing,
    form: { register, control, handleSubmit, reset },
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
