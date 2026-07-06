import { Context, Effect, Layer } from "effect";
import { AudioDecodeError, AudioWorkerError, toPublicAudioError } from "./audioErrors";
import {
  decodeCobaltLocalProcessingMessageEffect,
  type CobaltDownloadPlan,
} from "./cobaltAudioSchemas";

type LocalAudioPlan = Extract<CobaltDownloadPlan, { status: "local-processing" }>;

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

interface MP3TagPicture {
  format: string;
  type: number;
  description: string;
  data: number[];
}

interface MP3TagReader {
  read: () => void;
  save?: () => void;
  error?: string;
  buffer?: ArrayBuffer;
  tags: {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    track?: string;
    v2?: {
      APIC?: MP3TagPicture[];
      TCOM?: string;
      TCOP?: string;
      TLAN?: string;
      TPE2?: string;
    };
  };
}

export interface ProcessLocalAudioRequest {
  plan: LocalAudioPlan;
  lastModified: number;
  fetchTunnelFile: (url: string, filename: string) => Effect.Effect<File, unknown>;
  signal?: AbortSignal;
}

type LocalAudioProcessorService = {
  readonly validateLocalAudioPlan: (plan: LocalAudioPlan) => Effect.Effect<void, Error>;
  readonly runLocalProcessingWorker: (
    request: LocalAudioProcessingRequest,
    signal?: AbortSignal,
  ) => Effect.Effect<Blob, Error>;
  readonly tagCobaltAudioFile: (
    file: File,
    plan: LocalAudioPlan,
    coverFile: File | undefined,
    lastModified: number,
  ) => Effect.Effect<File, Error>;
  readonly processLocalAudio: (request: ProcessLocalAudioRequest) => Effect.Effect<File, unknown>;
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
            message: "malformed Cobalt local processing message.",
            cause,
          }),
      ),
    );
  },
);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isMalformedTerminalLocalProcessingMessage = (data: unknown) => {
  if (!isObjectRecord(data) || !isObjectRecord(data.cobaltLocalProcessing)) {
    return false;
  }

  return "blob" in data.cobaltLocalProcessing || "error" in data.cobaltLocalProcessing;
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

export const validateLocalAudioPlan = (plan: LocalAudioPlan) => {
  if (plan.type !== "audio") {
    throw new Error("cobalt local processing response was not audio.");
  }
  if (!plan.audio) {
    throw new Error("cobalt local processing response missing audio settings.");
  }
  if (plan.tunnel.length === 0) {
    throw new Error("cobalt local processing response missing audio tunnel.");
  }
  if (plan.tunnel.length > 2) {
    throw new Error("cobalt local processing response included unexpected tunnels.");
  }
  if (plan.audio.cover && plan.tunnel.length !== 2) {
    throw new Error("cobalt local processing response missing cover tunnel.");
  }
};

export const applyCobaltAudioMetadata = (
  mp3tag: Pick<MP3TagReader, "tags">,
  metadata: Record<string, string | undefined> | undefined,
) => {
  if (!metadata) {
    return;
  }

  if (metadata.title) {
    mp3tag.tags.title = stripMetadataControlCharacters(metadata.title);
  }
  if (metadata.artist) {
    mp3tag.tags.artist = stripMetadataControlCharacters(metadata.artist);
  }
  if (metadata.album) {
    mp3tag.tags.album = stripMetadataControlCharacters(metadata.album);
  }
  if (metadata.date) {
    mp3tag.tags.year = stripMetadataControlCharacters(metadata.date);
  }
  if (metadata.genre) {
    mp3tag.tags.genre = stripMetadataControlCharacters(metadata.genre);
  }
  if (metadata.track) {
    mp3tag.tags.track = stripMetadataControlCharacters(metadata.track);
  }

  const v2Frames = {
    album_artist: "TPE2",
    composer: "TCOM",
    copyright: "TCOP",
    sublanguage: "TLAN",
  } as const;

  for (const [metadataKey, frameName] of Object.entries(v2Frames)) {
    const value = metadata[metadataKey];
    if (value) {
      mp3tag.tags.v2 ??= {};
      mp3tag.tags.v2[frameName] = stripMetadataControlCharacters(value);
    }
  }
};

const tagCobaltAudioFile = async (
  file: File,
  plan: LocalAudioPlan,
  coverFile: File | undefined,
  lastModified: number,
) => {
  const MP3Tag = (await import("mp3tag.js")).default;
  const mp3tag = new MP3Tag(await file.arrayBuffer(), true) as unknown as MP3TagReader;
  mp3tag.read();

  if (mp3tag.error) {
    throw new Error(mp3tag.error);
  }

  applyCobaltAudioMetadata(mp3tag, plan.output.metadata);

  if (coverFile) {
    mp3tag.tags.v2 ??= {};
    mp3tag.tags.v2.APIC = [
      {
        format: coverFile.type,
        type: 3,
        description: "cover",
        data: Array.from(new Uint8Array(await coverFile.arrayBuffer())),
      },
    ];
  }

  mp3tag.save?.();
  if (mp3tag.error || !mp3tag.buffer) {
    throw new Error(mp3tag.error ?? "unable to save metadata");
  }

  return new File([new Uint8Array(mp3tag.buffer)], plan.output.filename, {
    type: file.type,
    lastModified,
  });
};

const makeLocalAudioProcessor = Effect.fn("makeLocalAudioProcessor")(() =>
  Effect.sync(() =>
    LocalAudioProcessor.of(
      (() => {
        const service: LocalAudioProcessorService = {
          validateLocalAudioPlan: (plan) =>
            Effect.sync(() => {
              validateLocalAudioPlan(plan);
            }),
          runLocalProcessingWorker: (request, signal) =>
            runLocalProcessingWorker(request, signal).pipe(Effect.mapError(toPublicAudioError)),
          tagCobaltAudioFile: (file, plan, coverFile, lastModified) =>
            Effect.tryPromise({
              try: () => tagCobaltAudioFile(file, plan, coverFile, lastModified),
              catch: toPublicAudioError,
            }),
          processLocalAudio: ({ plan, lastModified, fetchTunnelFile, signal }) =>
            Effect.gen(function* () {
              yield* service.validateLocalAudioPlan(plan);

              const outputFormat = plan.output.filename.split(".").pop()?.toLowerCase();
              if (!outputFormat) {
                return yield* Effect.fail(
                  new Error("cobalt local processing response missing output format."),
                );
              }

              const audioTunnel = plan.tunnel[0];
              if (!audioTunnel) {
                return yield* Effect.fail(
                  new Error("cobalt local processing response missing audio tunnel."),
                );
              }

              const shouldPostTagAsMp3 = outputFormat === "mp3";
              const coverTunnel = shouldPostTagAsMp3 ? plan.tunnel[1] : undefined;
              const audioFileEffect = fetchTunnelFile(audioTunnel, "input-0");
              const audioAndCover = coverTunnel
                ? Effect.all([audioFileEffect, fetchTunnelFile(coverTunnel, "input-1")], {
                    concurrency: 2,
                  })
                : Effect.map(audioFileEffect, (audioFile) => [audioFile, undefined] as const);
              const [audioFile, coverFile] = yield* audioAndCover;
              const blob = yield* service.runLocalProcessingWorker(
                {
                  audioFile,
                  audio: {
                    copy: plan.audio.copy,
                    format: plan.audio.format,
                    bitrate: plan.audio.bitrate,
                  },
                  output: {
                    type: plan.output.type,
                    format: outputFormat,
                    metadata: plan.output.metadata,
                  },
                },
                signal,
              );
              signal?.throwIfAborted();

              const file = new File([blob], plan.output.filename, {
                type: plan.output.type,
                lastModified,
              });

              signal?.throwIfAborted();
              if (!shouldPostTagAsMp3) {
                return file;
              }

              return yield* service.tagCobaltAudioFile(file, plan, coverFile, lastModified);
            }),
        };

        return service;
      })(),
    ),
  ),
);

export class LocalAudioProcessor extends Context.Service<
  LocalAudioProcessor,
  LocalAudioProcessorService
>()("LocalAudioProcessor") {}

export const LocalAudioProcessorLive = Layer.effect(LocalAudioProcessor, makeLocalAudioProcessor());
