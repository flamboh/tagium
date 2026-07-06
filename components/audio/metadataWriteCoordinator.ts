import filenamify from "filenamify";
import {
  prepareDownloadedTrackHydration,
  resolveDownloadedTrackHydrationWrite,
  resolveDownloadedTrackHydrationWriteError,
} from "./fileMetadataOps";
import type { UploadedTrack } from "./mp3Utils";
import type { AudioMetadata, MetadataPatch, TagiumFile } from "./types";

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

const getNullableNumericPatchValue = (value: AudioMetadata["year"]): MetadataPatch["year"] =>
  value === undefined || Number.isNaN(value) ? null : value;

export const getPendingMetadataPatch = (file: TagiumFile): MetadataPatch | undefined =>
  file.pendingMetadataPatch;

export const createSubmittedMetadataPatch = (metadata: AudioMetadata): MetadataPatch => ({
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
): AudioMetadata =>
  syncFilenames ? { ...data, filename: filenamify(data.title, { replacement: "-" }) } : data;

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

export const applyMetadataPatch = (
  metadata: AudioMetadata,
  patch: MetadataPatch,
): AudioMetadata => ({
  ...metadata,
  ...(hasOwn(patch, "filename") ? { filename: patch.filename } : {}),
  ...(hasOwn(patch, "title") ? { title: patch.title } : {}),
  ...(hasOwn(patch, "artist") ? { artist: patch.artist } : {}),
  ...(hasOwn(patch, "album") ? { album: patch.album } : {}),
  ...(hasOwn(patch, "year") ? { year: patch.year } : {}),
  ...(hasOwn(patch, "genre") ? { genre: patch.genre } : {}),
  ...(hasOwn(patch, "picture") ? { picture: patch.picture } : {}),
  ...(hasOwn(patch, "trackNumber") ? { trackNumber: patch.trackNumber } : {}),
});

export const getFilenameFromPatch = (file: TagiumFile, patch: MetadataPatch) =>
  hasOwn(patch, "filename") && patch.filename ? `${patch.filename}.mp3` : file.filename;

export const withPendingMetadataPatch = (
  file: TagiumFile,
  pendingMetadataPatch: MetadataPatch | undefined,
) => ({
  ...file,
  pendingMetadataPatch,
  hasBufferedChanges: Boolean(pendingMetadataPatch),
});

export const withMergedPendingMetadataPatch = (
  file: TagiumFile,
  patch: MetadataPatch | undefined,
) => (patch ? withPendingMetadataPatch(file, { ...file.pendingMetadataPatch, ...patch }) : file);

export const clearPendingMetadataPatch = (file: TagiumFile) =>
  withPendingMetadataPatch(file, undefined);

export interface MetadataWriteCoordinatorDeps {
  parseDownloadedFile: (downloadedFile: File) => Promise<UploadedTrack | undefined>;
  writeMetadata: (file: TagiumFile, metadata: AudioMetadata) => Promise<File>;
  getLatestFile: (fileId: string) => TagiumFile | undefined;
  getSelectedDirtyFormMetadata: (fileId: string) => AudioMetadata | undefined;
  getDirtyMetadataFields: () => DirtyMetadataFields;
  getSyncFilenames: () => boolean;
  commitHydratedFile: (fileId: string, file: TagiumFile) => void;
}

export interface HydrateDownloadedTrackInput {
  fileId: string;
  downloadedFile: File;
  signal?: AbortSignal;
}

const isAbortError = (error: unknown) => {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
};

export const createMetadataWriteCoordinator = (deps: MetadataWriteCoordinatorDeps) => {
  const createDirtyPatch = (metadata: AudioMetadata) =>
    createDirtyMetadataPatch(metadata, deps.getDirtyMetadataFields(), deps.getSyncFilenames());

  const hydrateDownloadedTrack = async ({
    fileId,
    downloadedFile,
    signal,
  }: HydrateDownloadedTrackInput) => {
    signal?.throwIfAborted();
    const parsedUpload = await deps.parseDownloadedFile(downloadedFile);
    signal?.throwIfAborted();
    if (!parsedUpload) {
      throw new Error("downloaded track could not be parsed.");
    }

    const currentFile = deps.getLatestFile(fileId);
    if (!currentFile) return;

    const parsedFile = parsedUpload.file;
    const formMetadata = currentFile.metadata
      ? deps.getSelectedDirtyFormMetadata(fileId)
      : undefined;
    const currentPendingPatch = formMetadata
      ? createDirtyPatch(formMetadata)
      : getPendingMetadataPatch(currentFile);
    const currentFileWithPendingPatch = currentPendingPatch
      ? withPendingMetadataPatch(currentFile, currentPendingPatch)
      : currentFile;
    let { hydratedFile, metadataToWrite } = prepareDownloadedTrackHydration(
      currentFileWithPendingPatch,
      parsedFile,
      currentPendingPatch,
    );

    if (metadataToWrite) {
      signal?.throwIfAborted();
      try {
        const updatedFile = await deps.writeMetadata(hydratedFile, metadataToWrite);
        signal?.throwIfAborted();
        const latestFile = deps.getLatestFile(fileId);
        if (!latestFile) return;

        const latestFormMetadata = deps.getSelectedDirtyFormMetadata(fileId);
        const latestFormPatch = latestFormMetadata
          ? createDirtyPatch(latestFormMetadata)
          : undefined;
        const latestMetadataForResolve =
          latestFormPatch && latestFile.metadata
            ? applyMetadataPatch(latestFile.metadata, latestFormPatch)
            : latestFormMetadata;

        hydratedFile = resolveDownloadedTrackHydrationWrite(
          currentFileWithPendingPatch,
          latestFormPatch
            ? withMergedPendingMetadataPatch(latestFile, latestFormPatch)
            : latestFile,
          parsedFile,
          hydratedFile,
          updatedFile,
          metadataToWrite,
          latestMetadataForResolve,
        );
      } catch (error) {
        if (isAbortError(error)) throw error;

        const latestFile = deps.getLatestFile(fileId);
        if (!latestFile) return;

        let message = "downloaded, but metadata could not be applied.";
        if (error instanceof Error) {
          message = error.message;
        }

        hydratedFile = resolveDownloadedTrackHydrationWriteError(
          currentFileWithPendingPatch,
          latestFile,
          parsedFile,
          hydratedFile,
          message,
        );
      }
    }

    signal?.throwIfAborted();
    const hydratedPendingPatch =
      metadataToWrite && hydratedFile.status !== "saved"
        ? (getPendingMetadataPatch(hydratedFile) ??
          (hydratedFile.metadata
            ? createSubmittedMetadataPatch(hydratedFile.metadata)
            : metadataToWrite))
        : undefined;

    deps.commitHydratedFile(fileId, withPendingMetadataPatch(hydratedFile, hydratedPendingPatch));
  };

  return { hydrateDownloadedTrack };
};
