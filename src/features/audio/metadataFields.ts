import type { AudioMetadata, MetadataPatch } from "@/features/audio/metadata";

export const EDITABLE_METADATA_FIELDS = [
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
] as const satisfies readonly (keyof MetadataPatch)[];

export type EditableMetadataField = (typeof EDITABLE_METADATA_FIELDS)[number];

export const NULLABLE_NUMERIC_METADATA_FIELDS = [
  "year",
  "trackNumber",
  "discNumber",
  "bpm",
] as const satisfies readonly EditableMetadataField[];

export type AdvancedNumericMetadataField = "discNumber" | "bpm";

const advancedNumberLabels = {
  discNumber: "disc number",
  bpm: "BPM",
} as const satisfies Record<AdvancedNumericMetadataField, string>;

export const validateAdvancedMetadataNumber = (
  field: AdvancedNumericMetadataField,
  value: number | null | undefined,
): string | undefined => {
  if (
    value === null ||
    value === undefined ||
    (Number.isFinite(value) && Number.isInteger(value) && value >= 1 && value <= 999)
  ) {
    return undefined;
  }
  return `${advancedNumberLabels[field]} must be a whole number from 1 to 999.`;
};

export const getAdvancedMetadataValidationErrors = (
  metadata: Pick<AudioMetadata, AdvancedNumericMetadataField>,
) => {
  const discNumber = validateAdvancedMetadataNumber("discNumber", metadata.discNumber);
  const bpm = validateAdvancedMetadataNumber("bpm", metadata.bpm);
  return {
    ...(discNumber ? { discNumber } : {}),
    ...(bpm ? { bpm } : {}),
  };
};
