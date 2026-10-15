import { Context, Effect, Layer } from "effect";
import {
  AudioDecodeError,
  AudioWorkerError,
  toPublicAudioError,
} from "@/features/audio/audioErrors";
import { decodeCobaltLocalProcessingMessageEffect } from "@/features/import/cobaltAudioSchemas";
import {
  inspectAudioFile,
  patchAudioFileWithChanges,
} from "@/features/audio/metadataEngine/engine";
import type { MetadataChanges } from "@/features/audio/metadataEngine/types";
import { cropCoverArtToSquare } from "@/features/editor/coverArtProcessing";

type LocalAudioProcessingRequest = {
  audioFile: File;
  audio: {
    copy: boolean;
    format: string;
    bitrate: string;
  };
  output: {
    type: string;
    format: string;
    metadata?: Record<string, string | undefined>;
  };
};

export interface LocalAudioOutput {
  filename: string;
  type: string;
  metadata?: Record<string, string | undefined>;
}

export interface ProcessAudioRequest {
  audioFile: File;
  coverFile?: File;
  audio: {
    copy: boolean;
    format: string;
    bitrate: string;
    cropCover?: boolean;
  };
  output: LocalAudioOutput;
  lastModified: number;
  signal?: AbortSignal;
}

type LocalAudioProcessorService = {
  readonly processAudio: (request: ProcessAudioRequest) => Effect.Effect<File, Error>;
};

export const canPostTagAudioFilename = (filename: string) => {
  const extension = filename.split(".").pop()?.toLowerCase();

  return extension === "mp3" || extension === "m4a" || extension === "opus";
};

const stripMetadataControlCharacters = (value: string) =>
  Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);

      return code > 31 && code !== 127;
    })
    .join("");

const decodeCobaltLocalProcessingMessage = Effect.fn("decodeCobaltLocalProcessingMessage")(
  function* (input: unknown) {
    return yield* decodeCobaltLocalProcessingMessageEffect(input).pipe(
      Effect.mapError(
        (cause) =>
          new AudioDecodeError({
            message: "malformed cobalt local processing message.",
            cause,
          }),
      ),
    );
  },
);

const isObjectState = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const isMalformedTerminalLocalProcessingMessage = (data: unknown) => {
  if (!isObjectState(data) || !("cobaltLocalProcessing" in data)) return false;
  const message = data.cobaltLocalProcessing;

  return isObjectState(message) && ("blob" in message || "error" in message);
};

const runLocalProcessingWorker = (request: LocalAudioProcessingRequest, signal?: AbortSignal) =>
  Effect.acquireUseRelease(
    Effect.sync(
      () =>
        new Worker(new URL("./cobaltLocalProcessingWorker.js", import.meta.url), {
          type: "module",
        }),
    ),
    (worker) =>
      Effect.callback<Blob, Error>((resume) => {
        let completed = false;

        const complete = (effect: Effect.Effect<Blob, Error>) => {
          if (completed) {
            return;
          }

          completed = true;
          cleanup();
          resume(effect);
        };

        const cleanup = () => {
          signal?.removeEventListener("abort", onAbort);
        };

        const onAbort = () => {
          complete(Effect.fail(toPublicAudioError(signal?.reason)));
        };

        try {
          signal?.throwIfAborted();
        } catch (error) {
          complete(Effect.fail(toPublicAudioError(error)));

          return Effect.void;
        }

        signal?.addEventListener("abort", onAbort, { once: true });

        worker.onmessage = (event: MessageEvent) => {
          Effect.runPromise(decodeCobaltLocalProcessingMessage(event.data)).then(
            (decodedMessage) => {
              const message = decodedMessage.cobaltLocalProcessing;

              if ("blob" in message) {
                complete(Effect.succeed(message.blob));

                return;
              }

              if ("error" in message) {
                complete(
                  Effect.fail(
                    toPublicAudioError(
                      new AudioWorkerError({
                        message: message.error,
                        cause: event.data,
                      }),
                    ),
                  ),
                );
              }
            },
            (error) => {
              if (isMalformedTerminalLocalProcessingMessage(event.data)) {
                complete(Effect.fail(toPublicAudioError(error)));
              }
            },
          );
        };

        worker.onerror = (error) => {
          complete(Effect.fail(new Error(error.message)));
        };

        worker.postMessage({
          cobaltLocalProcessing: request,
        });

        return Effect.sync(cleanup);
      }),
    (worker) =>
      Effect.sync(() => {
        worker.terminate();
      }),
  );

const tagAudioFile = async (
  file: File,
  output: LocalAudioOutput,
  coverFile: File | undefined,
  cropCover: boolean,
  lastModified: number,
) => {
  const { inspection, metadata } = await Effect.runPromise(inspectAudioFile(file));
  const supplied = output.metadata;
  const changes: MetadataChanges = {};

  if (supplied?.title) changes.title = stripMetadataControlCharacters(supplied.title);

  if (supplied?.artist) changes.artist = stripMetadataControlCharacters(supplied.artist);

  if (supplied?.album) changes.album = stripMetadataControlCharacters(supplied.album);

  if (supplied?.date) changes.dateText = stripMetadataControlCharacters(supplied.date);

  if (supplied?.genre) changes.genre = stripMetadataControlCharacters(supplied.genre);

  if (supplied?.track) changes.trackText = stripMetadataControlCharacters(supplied.track);

  if (supplied?.album_artist)
    changes.albumArtist = stripMetadataControlCharacters(supplied.album_artist);

  if (supplied?.composer) changes.composer = stripMetadataControlCharacters(supplied.composer);

  const supportsExtendedText =
    inspection.format.kind === "mp3" || inspection.format.kind === "opus";

  if (supportsExtendedText && supplied?.copyright) {
    changes.copyright = stripMetadataControlCharacters(supplied.copyright);
  }

  if (supportsExtendedText && supplied?.sublanguage) {
    changes.language = stripMetadataControlCharacters(supplied.sublanguage);
  }

  if (coverFile) {
    const cover = cropCover
      ? await cropCoverArtToSquare(coverFile).catch(() => coverFile)
      : coverFile;

    changes.picture = [
      {
        format: cover.type || "image/jpeg",
        type: 3,
        description: "cover",
        data: new Uint8Array(await cover.arrayBuffer()),
      },
    ];
  }

  const tagged = await Effect.runPromise(
    patchAudioFileWithChanges(file, changes, metadata.filename),
  );

  return new File([tagged], output.filename, {
    type: tagged.type,
    lastModified,
  });
};

const processAudio = ({
  audioFile,
  coverFile,
  audio,
  output,
  lastModified,
  signal,
}: ProcessAudioRequest) =>
  Effect.gen(function* () {
    const outputFormat = output.filename.split(".").pop()?.toLowerCase();

    if (!outputFormat) {
      return yield* Effect.fail(new Error("local audio processing is missing an output format."));
    }

    const blob = yield* runLocalProcessingWorker(
      {
        audioFile,
        audio: { copy: audio.copy, format: audio.format, bitrate: audio.bitrate },
        output: { type: output.type, format: outputFormat, metadata: output.metadata },
      },
      signal,
    ).pipe(Effect.mapError(toPublicAudioError));

    signal?.throwIfAborted();

    const file = new File([blob], output.filename, { type: output.type, lastModified });

    if (!canPostTagAudioFilename(output.filename) || (!coverFile && !output.metadata)) {
      return file;
    }

    return yield* Effect.tryPromise({
      try: () => tagAudioFile(file, output, coverFile, audio.cropCover === true, lastModified),
      catch: toPublicAudioError,
    });
  });

export class LocalAudioProcessor extends Context.Service<
  LocalAudioProcessor,
  LocalAudioProcessorService
>()("LocalAudioProcessor") {}

export const LocalAudioProcessorLive = Layer.succeed(
  LocalAudioProcessor,
  LocalAudioProcessor.of({ processAudio }),
);
