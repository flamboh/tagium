import type { TrackSourceMix } from "@/analytics";
import { sanitizeFilenameBase } from "@/features/library/filename";
import type { UploadedTrack } from "@/features/audio/mp3Utils";
import type { AudioMetadata, MetadataPatch, TagiumFile } from "@/features/library/types";

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

export const getFileImportKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

export const getTagiumFileImportKey = (file: TagiumFile) =>
  file.sourceImportKey ?? (file.originalFile ? getFileImportKey(file.originalFile) : undefined);

export const getTrackSourceMix = (files: TagiumFile[]): TrackSourceMix => {
  if (files.length === 0) return "unknown";
  const importedCount = files.filter((file) => Boolean(file.downloadRequest)).length;
  if (importedCount === 0) return "local";
  if (importedCount === files.length) return "imported";
  return "mixed";
};

export const getAcceptedUploadParseResult = (uploads: UploadedTrack[]) => {
  const acceptedUploads = uploads.filter((upload) => upload.file.status !== "error");
  return {
    acceptedUploads,
    parseRejectedCount: uploads.length - acceptedUploads.length,
  };
};

export const getUploadRejectionMessage = (rejectedUploads: UploadedTrack[]) =>
  rejectedUploads
    .map((upload) => upload.file.downloadError ?? `${upload.file.filename} could not be imported.`)
    .join("\n");

export const getNullableNumericMetadataValue = (
  value: AudioMetadata["year"] | undefined,
): AudioMetadata["year"] => (value === undefined || Number.isNaN(value) ? null : value);

export const getNullableNumericPatchValue = (
  value: AudioMetadata["year"] | undefined,
): MetadataPatch["year"] => (value === undefined || Number.isNaN(value) ? null : value);

export const getSubmittedAudioMetadata = (
  data: AudioMetadata,
  syncFilenames: boolean,
): AudioMetadata => ({
  ...data,
  filename: sanitizeFilenameBase(syncFilenames ? data.title : data.filename),
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
