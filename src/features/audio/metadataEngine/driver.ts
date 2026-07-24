import type { Effect } from "effect";
import { AudioMetadataWriteError, type AudioMetadataReadError } from "@/features/audio/audioErrors";
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

export const rejectUnsupportedMetadataChanges = (
  changes: MetadataChanges,
  supported: ReadonlySet<keyof MetadataChanges>,
  format: AudioFormat["kind"],
) => {
  const unsupported = (Object.keys(changes) as Array<keyof MetadataChanges>).filter(
    (field) => changes[field] !== undefined && !supported.has(field),
  );
  return unsupported.length === 0
    ? undefined
    : new AudioMetadataWriteError({
        message: `${format.toUpperCase()} does not support writing: ${unsupported.join(", ")}.`,
        cause: undefined,
      });
};
