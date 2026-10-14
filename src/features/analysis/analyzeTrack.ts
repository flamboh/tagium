import { Effect } from "effect";
import { AudioDecodeError, AudioWorkerError } from "@/features/audio/audioErrors";
import {
  ANALYSIS_SAMPLE_RATE,
  MAX_ANALYSIS_SECONDS,
  MAX_ANALYZED_SECONDS,
  mixToMono,
  type TrackAnalysis,
} from "@/features/analysis/trackAnalysis";
import type {
  TrackAnalysisMessage,
  TrackAnalysisRequest,
} from "@/features/analysis/trackAnalysisWorker";

const MAX_ANALYSIS_FILE_BYTES = 256 * 1024 * 1024;

// A 15 minute stereo track decodes to about 152 mib at the analysis rate.
const MAX_DECODED_PCM_BYTES = 160 * 1024 * 1024;

const PCM_BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;

const decodeFailure = (message: string, cause?: unknown) =>
  new AudioDecodeError({ message, cause });

const decodeMono = (file: File) =>
  Effect.tryPromise({
    try: async () => {
      // decodeAudioData resamples to the context rate, so the decoded buffer stays small, and
      // it detaches the file's bytes, so they can be collected as soon as decoding starts.
      const context = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE);
      const decoded = await context.decodeAudioData(await file.arrayBuffer());

      if (decoded.duration > MAX_ANALYSIS_SECONDS) {
        throw decodeFailure("audio is too long to analyze.");
      }

      if (
        decoded.length * decoded.numberOfChannels * PCM_BYTES_PER_SAMPLE >
        MAX_DECODED_PCM_BYTES
      ) {
        throw decodeFailure("decoded audio is too large to analyze.");
      }

      // One mono copy of the analyzed window is all that crosses to the worker; the decoded
      // buffer is dropped when this returns.
      return mixToMono(
        Array.from({ length: decoded.numberOfChannels }, (_, index) =>
          decoded.getChannelData(index),
        ),
        MAX_ANALYZED_SECONDS * ANALYSIS_SAMPLE_RATE,
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

    worker.postMessage(request, [request.samples.buffer]);

    // An interrupted analysis cannot be cancelled inside wasm, so its worker is discarded.
    return Effect.sync(releaseWorker);
  });

/** Estimates a track's tempo and key off the main thread. */
export const analyzeTrack = (file: File, durationHint: number) =>
  Effect.gen(function* () {
    if (durationHint > MAX_ANALYSIS_SECONDS) {
      return yield* Effect.fail(decodeFailure("audio is too long to analyze."));
    }

    const estimatedPcmBytes = durationHint * ANALYSIS_SAMPLE_RATE * 2 * PCM_BYTES_PER_SAMPLE;

    if (file.size > MAX_ANALYSIS_FILE_BYTES || estimatedPcmBytes > MAX_DECODED_PCM_BYTES) {
      return yield* Effect.fail(decodeFailure("audio is too large to analyze."));
    }

    if (typeof OfflineAudioContext === "undefined") {
      return yield* Effect.fail(decodeFailure("audio decoding is unavailable."));
    }

    const samples = yield* decodeMono(file);

    return yield* runAnalysisWorker({ samples });
  });
