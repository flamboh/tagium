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
  "albumArtist",
  "album",
  "year",
  "genre",
  "picture",
  "trackNumber",
  "discNumber",
  "composer",
  "bpm",
  "comment",
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

export const validateDiscNumber = (value: number | null | undefined) =>
  value === null ||
  (typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 999) ||
  "disc number must be a whole number from 1 to 999";

export const validateBpm = (value: number | null | undefined) =>
  value === null ||
  (typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 999) ||
  "BPM must be from 1 to 999";

export const getAdvancedMetadataValidationErrors = (metadata: {
  discNumber: AudioMetadata["discNumber"] | undefined;
  bpm: AudioMetadata["bpm"] | undefined;
}) => {
  const discNumber = validateDiscNumber(metadata.discNumber);
  const bpm = validateBpm(metadata.bpm);
  return {
    ...(discNumber === true ? {} : { discNumber }),
    ...(bpm === true ? {} : { bpm }),
  };
};

export const getProjectableAudioMetadata = (
  metadata: AudioMetadata,
  fallback?: AudioMetadata,
  validationSource: Pick<AudioMetadata, "discNumber" | "bpm"> = metadata,
): AudioMetadata => ({
  ...metadata,
  discNumber:
    validateDiscNumber(validationSource.discNumber) === true
      ? metadata.discNumber
      : fallback && validateDiscNumber(fallback.discNumber) === true
        ? fallback.discNumber
        : null,
  bpm:
    validateBpm(validationSource.bpm) === true
      ? metadata.bpm
      : fallback && validateBpm(fallback.bpm) === true
        ? fallback.bpm
        : null,
});

export const getSubmittedAudioMetadata = (
  data: AudioMetadata,
  syncFilenames: boolean,
  advancedMetadata = true,
  linkAlbumArtist = false,
): AudioMetadata => ({
  ...data,
  filename: sanitizeFilenameBase(syncFilenames ? data.title : data.filename),
  albumArtist: !advancedMetadata || linkAlbumArtist ? data.artist : data.albumArtist,
  year: getNullableNumericMetadataValue(data.year),
  trackNumber: getNullableNumericMetadataValue(data.trackNumber),
  discNumber: getNullableNumericMetadataValue(data.discNumber),
  bpm: getNullableNumericMetadataValue(data.bpm),
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
        patch.discNumber = getNullableNumericPatchValue(metadata.discNumber);
        break;
      case "composer":
        patch.composer = metadata.composer;
        break;
      case "bpm":
        patch.bpm = getNullableNumericPatchValue(metadata.bpm);
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
