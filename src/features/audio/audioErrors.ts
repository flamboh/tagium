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

export const toPublicAudioError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return new Error(error.message);
  }

  return new Error(String(error));
};
