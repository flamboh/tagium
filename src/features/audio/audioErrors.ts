import { Schema } from "effect";

export class AudioDecodeError extends Schema.TaggedErrorClass<AudioDecodeError>()(
  "AudioDecodeError",
  {
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class AudioWorkerError extends Schema.TaggedErrorClass<AudioWorkerError>()(
  "AudioWorkerError",
  {
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class AudioMetadataReadError extends Schema.TaggedErrorClass<AudioMetadataReadError>()(
  "AudioMetadataReadError",
  {
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class AudioMetadataWriteError extends Schema.TaggedErrorClass<AudioMetadataWriteError>()(
  "AudioMetadataWriteError",
  {
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export type AudioError =
  | AudioDecodeError
  | AudioWorkerError
  | AudioMetadataReadError
  | AudioMetadataWriteError;

export const toPublicAudioError = (cause: unknown): Error => {
  if (cause instanceof Error) {
    return cause;
  }

  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return new Error(cause.message);
  }

  return new Error(String(cause));
};
