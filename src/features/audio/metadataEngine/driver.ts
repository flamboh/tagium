import type { Effect } from "effect";
import type { AudioMetadataReadError, AudioMetadataWriteError } from "@/features/audio/audioErrors";
import type { ByteSource } from "@/features/audio/metadataEngine/byteSource";
import type {
  AudioFormat,
  AudioInspection,
  MetadataChanges,
  PatchPlan,
} from "@/features/audio/metadataEngine/types";

export interface FormatDriver {
  readonly format: AudioFormat;
  readonly inspect: (source: ByteSource) => Effect.Effect<AudioInspection, AudioMetadataReadError>;
  readonly patch: (
    source: ByteSource,
    changes: MetadataChanges,
  ) => Effect.Effect<PatchPlan, AudioMetadataWriteError>;
}
