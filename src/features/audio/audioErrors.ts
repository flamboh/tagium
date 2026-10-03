import { Schema } from "effect";

export class AudioDecodeError extends Schema.TaggedError<AudioDecodeError>()("AudioDecodeError", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

export class AudioWorkerError extends Schema.TaggedError<AudioWorkerError>()("AudioWorkerError", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

export class AudioMetadataReadError extends Schema.TaggedError<AudioMetadataReadError>()(
  "AudioMetadataReadError",
  {
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class AudioMetadataWriteError extends Schema.TaggedError<AudioMetadataWriteError>()(
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

export const AUDIO_IMPORT_ERROR_MESSAGES = {
  vorbisOgg: "this ogg file uses vorbis audio.",
  unsupportedOgg: "this ogg file does not use opus audio.",
  wav: "wav files are not supported.",
  aiff: "aiff files are not supported.",
} as const;

const publicAudioImportErrors = new Set<string>(Object.values(AUDIO_IMPORT_ERROR_MESSAGES));

export const getPublicAudioImportError = (message: string | undefined) =>
  message && publicAudioImportErrors.has(message) ? message : undefined;

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
