import { Context, Effect, Layer } from "effect";
import {
  LocalAudioProcessor,
  LocalAudioProcessorLive,
} from "@/features/import/localAudioProcessor";
import { getStableLastModified, type AudioDownloadRequest } from "@/features/import/cobaltAudio";
import {
  acquireExtensionAudio,
  ExtensionCanceledError,
  extensionState,
  updateExtensionState,
} from "@/features/import/youtubeExtensionBridge";
import { createConcurrencyLimiter } from "@/shared/download/concurrencyLimiter";
import { toPublicAudioError } from "@/features/audio/audioErrors";
import { ImportStageError } from "@/features/import/importLifecycle";

class YouTubeExtensionAudio extends Context.Service<
  YouTubeExtensionAudio,
  {
    download: (
      request: AudioDownloadRequest,
      videoId: string,
    ) => Effect.Effect<File | undefined, Error>;
  }
>()("YouTubeExtensionAudio") {}

const downloads = createConcurrencyLimiter(1);

const make = Effect.gen(function* () {
  const processor = yield* LocalAudioProcessor;

  return YouTubeExtensionAudio.of({
    download: (request, videoId) =>
      Effect.gen(function* () {
        if (!extensionState.getSnapshot().enabled) return undefined;

        const acquired = yield* Effect.tryPromise({
          try: () =>
            downloads.run(() => acquireExtensionAudio(videoId, request.signal), request.signal),
          catch: toPublicAudioError,
        }).pipe(
          Effect.catch((error) => {
            if (request.signal?.aborted || error instanceof ExtensionCanceledError)
              return Effect.fail(error);
            updateExtensionState({
              notice:
                "extension download failed. trying the server; you can also upload an audio file.",
            });

            return Effect.succeed(undefined);
          }),
        );

        if (!acquired) return undefined;
        const best = request.audioFormat === "best";
        const format = best ? (acquired.file.type === "audio/mp4" ? "m4a" : "opus") : "mp3";
        const type = { m4a: "audio/mp4", opus: "audio/ogg", mp3: "audio/mpeg" }[format];
        const year = request.year ?? request.fallbackYear;

        return yield* processor
          .processAudio({
            audioFile: acquired.file,
            audio: { copy: best, format, bitrate: request.audioBitrate },
            output: {
              filename: `${acquired.title.replace(/[/\\]/g, "_") || videoId}.${format}`,
              type,
              metadata: {
                title: acquired.title,
                artist: acquired.artist,
                album: request.singleAlbum ? acquired.title : undefined,
                date: year === undefined ? undefined : String(year),
              },
            },
            lastModified: getStableLastModified(request.sourceUrl),
            signal: request.signal,
          })
          .pipe(Effect.mapError((error) => new ImportStageError("processing", error)));
      }),
  });
});

export { YouTubeExtensionAudio };

export const YouTubeExtensionAudioLive = Layer.effect(YouTubeExtensionAudio, make).pipe(
  Layer.provide(LocalAudioProcessorLive),
);
