import { Context, Effect, Layer, Schema } from "effect";
import {
  AudioMetadataReadError,
  AudioMetadataWriteError,
  toPublicAudioError,
} from "@/features/audio/audioErrors";
import { audioMetadataSchema } from "@/features/audio/metadata";
import { inspectAudioFile, patchAudioFile } from "@/features/audio/metadataEngine/engine";
import { toGenreString, type UploadedTrack } from "@/features/audio/mp3Utils";
import type { AudioMetadata, TagiumFile } from "@/features/library/types";

const decodeAudioMetadata = Schema.decodeUnknownSync(audioMetadataSchema);

const parseUploadedTrack = (file: File) =>
  Effect.gen(function* () {
    const id = crypto.randomUUID();
    return yield* inspectAudioFile(file).pipe(
      Effect.flatMap(({ inspection, metadata }) =>
        Effect.try({
          try: () => {
            const decoded = decodeAudioMetadata(metadata);
            return {
              file: {
                id,
                format: inspection.format,
                file,
                originalFile: file,
                filename: file.name,
                status: "pending",
                downloadStatus: "ready",
                hasBufferedChanges: false,
                metadata: decoded,
              },
              albumSeed: {
                title: decoded.album.trim(),
                artist: decoded.artist.trim(),
                genre: toGenreString(decoded.genre),
                cover: decoded.picture.length > 0 ? decoded.picture : undefined,
              },
            } satisfies UploadedTrack;
          },
          catch: (cause) =>
            new AudioMetadataReadError({
              message: "unable to decode canonical audio metadata.",
              cause,
            }),
        }),
      ),
      Effect.catch((cause) => {
        const error = toPublicAudioError(cause);
        console.error(`error parsing metadata for ${file.name}:`, error);
        return Effect.succeed({
          file: {
            id,
            file,
            originalFile: file,
            filename: file.name,
            status: "error",
            downloadStatus: "ready",
            downloadError: error.message,
            hasBufferedChanges: false,
          },
          albumSeed: { title: "", artist: "", genre: "" },
        } satisfies UploadedTrack);
      }),
    );
  });

const writeMetadata = (fileToUpdate: TagiumFile, newTags: AudioMetadata) =>
  Effect.gen(function* () {
    if (!fileToUpdate.file) {
      return yield* Effect.fail(
        new AudioMetadataWriteError({
          message: "audio file is still downloading.",
          cause: undefined,
        }),
      );
    }
    const metadata = yield* Effect.try({
      try: () => decodeAudioMetadata(newTags),
      catch: (cause) =>
        new AudioMetadataWriteError({ message: "unable to decode metadata changes.", cause }),
    });
    return yield* patchAudioFile(fileToUpdate.file, metadata);
  });

export interface AudioMetadataIOService {
  readonly parseUploadedTracks: (uploadedFiles: File[]) => Effect.Effect<UploadedTrack[], never>;
  readonly writeMetadataToFile: (
    fileToUpdate: TagiumFile,
    newTags: AudioMetadata,
  ) => Effect.Effect<File, AudioMetadataWriteError>;
}

export class AudioMetadataIO extends Context.Service<AudioMetadataIO, AudioMetadataIOService>()(
  "AudioMetadataIO",
) {}

export const AudioMetadataIOLive = Layer.succeed(
  AudioMetadataIO,
  AudioMetadataIO.of({
    parseUploadedTracks: (uploadedFiles) =>
      Effect.forEach(uploadedFiles, parseUploadedTrack, { concurrency: 3 }),
    writeMetadataToFile: writeMetadata,
  }),
);
