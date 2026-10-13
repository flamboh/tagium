import { Effect } from "effect";
import { AudioDecodeError, AudioWorkerError } from "@/features/audio/audioErrors";
import {
  ANALYSIS_SAMPLE_RATE,
  MAX_ANALYSIS_SECONDS,
  type TrackAnalysis,
} from "@/features/analysis/trackAnalysis";
import type {
  TrackAnalysisMessage,
  TrackAnalysisRequest,
} from "@/features/analysis/trackAnalysisWorker";

const MAX_ANALYSIS_FILE_BYTES = 256 * 1024 * 1024;

const decodeFailure = (message: string, cause?: unknown) =>
  new AudioDecodeError({ message, cause });

const decodeChannels = (file: File) =>
  Effect.tryPromise({
    try: async () => {
      // decodeAudioData resamples to the context rate, so the decoded buffer stays small.
      const context = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE);
      const decoded = await context.decodeAudioData(await file.arrayBuffer());

      if (decoded.duration > MAX_ANALYSIS_SECONDS) {
        throw decodeFailure("audio is too long to analyze.");
      }

      // Copies leave the decoded buffer behind so the samples can be transferred to the worker.
      return Array.from({ length: decoded.numberOfChannels }, (_, index) =>
        decoded.getChannelData(index).slice(),
      );
    },
    catch: (cause) =>
      cause instanceof AudioDecodeError ? cause : decodeFailure("unable to decode audio.", cause),
  });

// The worker holds a compiled wasm module, so it is reused; callers analyze one track at a time.
let sharedWorker: Worker | undefined;

const releaseWorker = () => {
  sharedWorker?.terminate();
  sharedWorker = undefined;
};

const runAnalysisWorker = (request: TrackAnalysisRequest) =>
  Effect.callback<TrackAnalysis, AudioWorkerError>((resume) => {
    const worker = (sharedWorker ??= new Worker(
      new URL("./trackAnalysisWorker.ts", import.meta.url),
      { type: "module" },
    ));

    worker.onmessage = (event: MessageEvent<TrackAnalysisMessage>) => {
      const message = event.data;
      resume(
        "analysis" in message
          ? Effect.succeed(message.analysis)
          : Effect.fail(new AudioWorkerError({ message: message.error, cause: message })),
      );
    };

    worker.onerror = (event) => {
      releaseWorker();
      resume(
        Effect.fail(
          new AudioWorkerError({
            message: event.message || "track analysis failed.",
            cause: event,
          }),
        ),
      );
    };

    worker.postMessage(
      request,
      request.channels.map((channel) => channel.buffer),
    );

    // An interrupted analysis cannot be cancelled inside wasm, so its worker is discarded.
    return Effect.sync(releaseWorker);
  });

/** Estimates a track's tempo and key off the main thread. */
export const analyzeTrack = (file: File, durationHint: number) =>
  Effect.gen(function* () {
    if (durationHint > MAX_ANALYSIS_SECONDS) {
      return yield* Effect.fail(decodeFailure("audio is too long to analyze."));
    }

    if (file.size > MAX_ANALYSIS_FILE_BYTES) {
      return yield* Effect.fail(decodeFailure("audio is too large to analyze."));
    }

    if (typeof OfflineAudioContext === "undefined") {
      return yield* Effect.fail(decodeFailure("audio decoding is unavailable."));
    }

    const channels = yield* decodeChannels(file);

    return yield* runAnalysisWorker({ channels });
  });
