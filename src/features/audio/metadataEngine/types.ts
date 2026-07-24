import type { AudioMetadata } from "@/features/audio/metadata";

export type AudioFormatKind = "mp3" | "flac" | "m4a";

export interface AudioFormat {
  kind: AudioFormatKind;
  extension: "mp3" | "flac" | "m4a" | "mp4";
  mime: "audio/mpeg" | "audio/flac" | "audio/mp4";
}

export interface ArtworkEntry {
  format: string;
  type: number;
  description: string;
  data: Uint8Array<ArrayBuffer>;
  width?: number;
  height?: number;
  depth?: number;
  colors?: number;
  dataType?: number;
  dataLocale?: number;
  opaqueData?: Uint8Array<ArrayBuffer>;
}

export interface AudioInspection {
  format: AudioFormat;
  metadata: Omit<AudioMetadata, "filename">;
}

export interface MetadataChanges {
  title?: string;
  artist?: string;
  album?: string;
  year?: number | null;
  genre?: string | string[];
  trackNumber?: number | null;
  discNumber?: number | null;
  bpm?: number | null;
  picture?: ArtworkEntry[];
  dateText?: string;
  trackText?: string;
  albumArtist?: string;
  composer?: string;
  comment?: string;
  copyright?: string;
  language?: string;
}

export interface PatchPlan {
  parts: BlobPart[];
  type: AudioFormat["mime"];
}
