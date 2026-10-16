import { Context, Data, Effect, Layer, Schedule, Schema } from "effect";
import { AudioDecodeError, toPublicAudioError } from "@/features/audio/audioErrors";
import { createConcurrencyLimiter } from "@/shared/download/concurrencyLimiter";
import { getStableLastModified, type AudioDownloadRequest } from "@/features/import/cobaltAudio";
import { ImportStageError } from "@/features/import/importLifecycle";
import {
  LocalAudioProcessor,
  LocalAudioProcessorLive,
} from "@/features/import/localAudioProcessor";

export const SOUNDCLOUD_MAX_CONCURRENT_DOWNLOADS = 6;

const SEGMENT_CONCURRENCY = 4;

const SEGMENT_RETRIES = 3;

const SEGMENT_RETRY_DELAY_MS = 500;

const soundCloudStreamSchema = Schema.Struct({
  initUrl: Schema.String,
  segmentUrls: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  durationMs: Schema.Finite,
  metadata: Schema.Record(Schema.String, Schema.String),
  coverUrl: Schema.NullOr(Schema.String),
});

export type SoundCloudStream = Schema.Schema.Type<typeof soundCloudStreamSchema>;

export class SoundCloudPartError extends Data.TaggedError("SoundCloudPartError")<{
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

const isRetryablePartError = (error: SoundCloudPartError) => {
  if (error.cause instanceof DOMException && error.cause.name === "AbortError") return false;

  if (error.status === undefined) return true;

  return error.status === 408 || error.status === 429 || error.status >= 500;
};

export interface DownloadStreamPartsOptions {
  urls: readonly string[];
  concurrency?: number;
  retries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: { completed: number; total: number }) => void;
  fetch?: typeof globalThis.fetch;
}

export const downloadStreamParts = ({
  urls,
  concurrency = SEGMENT_CONCURRENCY,
  retries = SEGMENT_RETRIES,
  retryDelayMs = SEGMENT_RETRY_DELAY_MS,
  signal,
  onProgress,
  fetch = globalThis.fetch,
}: DownloadStreamPartsOptions) => {
  let completed = 0;

  const fetchPart = (url: string) =>
    Effect.tryPromise({
      try: async (interrupt) => {
        const response = await fetch(url, {
          signal: signal ? AbortSignal.any([signal, interrupt]) : interrupt,
        });

        if (!response.ok) {
          throw new SoundCloudPartError({
            message: `soundcloud stream part request failed (${response.status}).`,
            status: response.status,
          });
        }

        const bytes = new Uint8Array(await response.arrayBuffer());

        if (bytes.byteLength === 0) {
          throw new SoundCloudPartError({ message: "soundcloud stream part was empty." });
        }

        return bytes;
      },
      catch: (cause) =>
        cause instanceof SoundCloudPartError
          ? cause
          : new SoundCloudPartError({ message: toPublicAudioError(cause).message, cause }),
    }).pipe(
      Effect.retry({
        times: retries,
        while: isRetryablePartError,
        schedule: Schedule.exponential(retryDelayMs),
      }),
      Effect.tap(() =>
        Effect.sync(() => {
          completed += 1;
          onProgress?.({ completed, total: urls.length });
        }),
      ),
    );

  return Effect.forEach(urls, fetchPart, { concurrency });
};

const fetchStream = (request: AudioDownloadRequest) =>
  Effect.tryPromise({
    try: async () => {
      const headers = new Headers({
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Tagium-Request-Id": crypto.randomUUID(),
      });

      if (request.importId) headers.set("X-Tagium-Import-Id", request.importId);

      if (request.trackIndex !== undefined) {
        headers.set("X-Tagium-Track-Index", String(request.trackIndex));
      }

      const response = await fetch("/api/soundcloud-stream", {
        method: "POST",
        headers,
        signal: request.signal,
        body: JSON.stringify({ url: request.sourceUrl }),
      });

      if (!response.ok) throw new Error(await response.text());

      return await response.json();
    },
    catch: toPublicAudioError,
  }).pipe(
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(soundCloudStreamSchema)(body).pipe(
        Effect.mapError(
          (cause) => new AudioDecodeError({ message: "malformed soundcloud stream.", cause }),
        ),
      ),
    ),
    Effect.mapError((error) => new ImportStageError("plan", toPublicAudioError(error))),
  );

const fetchCover = (coverUrl: string, signal?: AbortSignal) =>
  Effect.promise(async () => {
    try {
      const response = await fetch(coverUrl, { signal });

      if (!response.ok) return undefined;
      const blob = await response.blob();

      return blob.size > 0
        ? new File([blob], "input-1", { type: blob.type || "image/jpeg" })
        : undefined;
    } catch {
      return undefined;
    }
  });

const outputFilename = (title: string | undefined, extension: string) =>
  `${(title ?? "soundcloud").replace(/[/\\]/g, "_")}.${extension}`;

export const soundCloudOutputMetadata = (
  stream: SoundCloudStream,
  request: Pick<AudioDownloadRequest, "year" | "fallbackYear">,
) => {
  const year = request.year ?? request.fallbackYear;

  return year === undefined ? stream.metadata : { ...stream.metadata, date: String(year) };
};

const soundCloudDownloads = createConcurrencyLimiter(SOUNDCLOUD_MAX_CONCURRENT_DOWNLOADS);

const makeSoundCloudAudio = Effect.fn("makeSoundCloudAudio")(function* () {
  const localAudioProcessor = yield* LocalAudioProcessor;

  const runDownload = (request: AudioDownloadRequest) =>
    Effect.gen(function* () {
      const stream = yield* fetchStream(request);
      const lastModified = getStableLastModified(request.sourceUrl);

      const [parts, coverFile] = yield* Effect.all(
        [
          downloadStreamParts({
            urls: [stream.initUrl, ...stream.segmentUrls],
            signal: request.signal,
          }).pipe(Effect.mapError((error) => new ImportStageError("tunnel", error))),
          stream.coverUrl ? fetchCover(stream.coverUrl, request.signal) : Effect.succeed(undefined),
        ],
        { concurrency: 2 },
      );

      const audioFile = new File(parts, "input-0", { type: "audio/mp4", lastModified });
      const best = request.audioFormat === "best";

      return yield* localAudioProcessor
        .processAudio({
          audioFile,
          coverFile,
          audio: {
            copy: best,
            format: best ? "m4a" : "mp3",
            bitrate: request.audioBitrate,
          },
          output: {
            filename: outputFilename(stream.metadata.title, best ? "m4a" : "mp3"),
            type: best ? "audio/mp4" : "audio/mpeg",
            metadata: soundCloudOutputMetadata(stream, request),
          },
          lastModified,
          signal: request.signal,
        })
        .pipe(Effect.mapError((error) => new ImportStageError("processing", error)));
    });

  const run = async (request: AudioDownloadRequest) => {
    try {
      return await Effect.runPromise(runDownload(request), { signal: request.signal });
    } catch (error) {
      request.signal?.throwIfAborted();
      throw error;
    }
  };

  return SoundCloudAudio.of({
    download: (request) =>
      Effect.tryPromise({
        try: () => soundCloudDownloads.run(() => run(request), request.signal),
        catch: toPublicAudioError,
      }),
  });
});

export class SoundCloudAudio extends Context.Service<
  SoundCloudAudio,
  {
    readonly download: (request: AudioDownloadRequest) => Effect.Effect<File, Error>;
  }
>()("SoundCloudAudio") {}

export const SoundCloudAudioLayer = Layer.effect(SoundCloudAudio, makeSoundCloudAudio());

export const SoundCloudAudioLive = SoundCloudAudioLayer.pipe(
  Layer.provide(LocalAudioProcessorLive),
);
