import { Effect } from "effect";
import { AudioMetadataReadError } from "@/features/audio/audioErrors";

export const MAX_METADATA_READ_BYTES = 8 * 1024 * 1024;

export interface ByteSource {
  readonly size: number;
  readonly read: (
    offset: number,
    length: number,
  ) => Effect.Effect<Uint8Array<ArrayBuffer>, AudioMetadataReadError>;
  readonly slice: (start?: number, end?: number) => Blob;
}

const readError = (message: string, cause?: unknown) =>
  new AudioMetadataReadError({ message, cause });

export const makeBlobByteSource = (blob: Blob): ByteSource => {
  let cached: { offset: number; bytes: Uint8Array<ArrayBuffer> } | undefined;
  return {
    size: blob.size,
    read: (offset, length) => {
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0
      ) {
        return Effect.fail(readError("invalid audio byte range."));
      }
      if (length > MAX_METADATA_READ_BYTES) {
        return Effect.fail(
          readError(`metadata read exceeds the ${MAX_METADATA_READ_BYTES} byte safety limit.`),
        );
      }
      if (offset > blob.size || offset + length > blob.size) {
        return Effect.fail(readError("audio file is truncated at a required metadata range."));
      }
      if (
        cached &&
        offset >= cached.offset &&
        offset + length <= cached.offset + cached.bytes.length
      ) {
        const start = offset - cached.offset;
        return Effect.succeed(cached.bytes.subarray(start, start + length));
      }
      return Effect.tryPromise({
        try: async () => {
          const bytes = new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
          cached = { offset, bytes };
          return bytes;
        },
        catch: (cause) => readError("unable to read audio metadata bytes.", cause),
      });
    },
    slice: (start, end) => blob.slice(start, end),
  };
};

export const readExactly = (source: ByteSource, offset: number, length: number, context: string) =>
  source.read(offset, length).pipe(
    Effect.mapError(
      (error) =>
        new AudioMetadataReadError({
          message: `${context}: ${error.message}`,
          cause: error,
        }),
    ),
  );
