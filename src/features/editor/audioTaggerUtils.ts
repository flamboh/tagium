import type { TrackSourceMix } from "@/analytics";
import {
  EDITABLE_METADATA_FIELDS,
  getAdvancedMetadataValidationErrors,
  validateAdvancedMetadataNumber,
} from "@/features/audio/metadataFields";
import { sanitizeFilenameBase } from "@/features/library/filename";
import type { UploadedTrack } from "@/features/audio/mp3Utils";
import type { AudioMetadata, MetadataPatch, TagiumFile } from "@/features/library/types";

type MetadataPatchField = keyof MetadataPatch;
type DirtyMetadataFields = Partial<Record<keyof AudioMetadata, unknown>>;

const metadataPatchFields = EDITABLE_METADATA_FIELDS satisfies readonly MetadataPatchField[];

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

export const validateDiscNumber = (value: number | null | undefined) =>
  validateAdvancedMetadataNumber("discNumber", value) ?? true;

export const validateBpm = (value: number | null | undefined) =>
  validateAdvancedMetadataNumber("bpm", value) ?? true;

export { getAdvancedMetadataValidationErrors };

export const getProjectableAudioMetadata = (
  metadata: AudioMetadata,
  fallback?: AudioMetadata,
  validationSource: Pick<AudioMetadata, "discNumber" | "bpm"> = metadata,
): AudioMetadata => ({
  ...metadata,
  discNumber:
    validateDiscNumber(validationSource.discNumber) === true
      ? metadata.discNumber
      : (fallback?.discNumber ?? null),
  bpm: validateBpm(validationSource.bpm) === true ? metadata.bpm : (fallback?.bpm ?? null),
});

export const getSubmittedAudioMetadata = (
  data: AudioMetadata,
  syncFilenames: boolean,
  albumArtistLinked = false,
): AudioMetadata => ({
  ...data,
  filename: sanitizeFilenameBase(syncFilenames ? data.title : data.filename),
  year: getNullableNumericMetadataValue(data.year),
  trackNumber: getNullableNumericMetadataValue(data.trackNumber),
  albumArtist: albumArtistLinked ? data.artist : data.albumArtist,
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
      case "albumArtist":
        patch.albumArtist = metadata.albumArtist;
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
      case "discNumber":
        if (validateDiscNumber(metadata.discNumber) === true) {
          patch.discNumber = getNullableNumericPatchValue(metadata.discNumber);
        }
        break;
      case "composer":
        patch.composer = metadata.composer;
        break;
      case "bpm":
        if (validateBpm(metadata.bpm) === true) {
          patch.bpm = getNullableNumericPatchValue(metadata.bpm);
        }
        break;
      case "comment":
        patch.comment = metadata.comment;
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
