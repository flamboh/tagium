import { Context, Effect, Layer } from "effect";
import { AudioDecodeError, toPublicAudioError } from "@/features/audio/audioErrors";
import { cobaltDownloadScheduler } from "@/shared/cobalt/cobaltDownloadScheduler";
import { decodeCobaltDownloadPlanEffect } from "@/features/import/cobaltAudioSchemas";
import {
  LocalAudioProcessor,
  LocalAudioProcessorLive,
} from "@/features/import/localAudioProcessor";
import type { CobaltTunnelElapsedBucket, CobaltTunnelOutcome } from "@/analytics";
import { ImportStageError } from "@/features/import/importLifecycle";

export type AudioDownloadBitrate = "320" | "256" | "128" | "96" | "64";
export type AudioDownloadFormat = "best" | "mp3";

interface CobaltAudioRequestBody {
  url: string;
  audioBitrate: AudioDownloadBitrate;
  audioFormat: AudioDownloadFormat;
  year?: number;
}

export type CobaltAudioDownloadLifecycleEvent =
  | {
      type: "tunnel-budget-wait-started";
    }
  | {
      type: "tunnel-budget-wait-ended";
    }
  | {
      type: "tunnel-readiness";
      outcome: CobaltTunnelOutcome;
      attempts: number;
      elapsedBucket: CobaltTunnelElapsedBucket;
    };

export type CobaltAudioDownloadLifecycleCallback = (
  event: CobaltAudioDownloadLifecycleEvent,
) => void;

export interface CobaltAudioDownloadRequest {
  sourceUrl: string;
  audioBitrate: AudioDownloadBitrate;
  audioFormat: AudioDownloadFormat;
  importId?: string;
  trackIndex?: number;
  year?: number;
  onLifecycle?: CobaltAudioDownloadLifecycleCallback;
  signal?: AbortSignal;
}

const MAX_TUNNEL_ATTEMPTS = 7;

const getStableLastModified = (sourceUrl: string) =>
  Array.from(sourceUrl).reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) % 2_147_483_647;
  }, 1);

const tunnelElapsedBucket = (elapsedMs: number): CobaltTunnelElapsedBucket => {
  if (elapsedMs < 1_000) return "under_1_second";
  if (elapsedMs < 5_000) return "1_to_5_seconds";
  if (elapsedMs < 15_000) return "5_to_15_seconds";
  return "15_seconds_or_more";
};

const tunnelReadinessFromResponse = (
  response: Response,
  elapsedMs: number,
): Extract<CobaltAudioDownloadLifecycleEvent, { type: "tunnel-readiness" }> | undefined => {
  const outcome = response.headers.get("X-Tagium-Tunnel-Outcome");
  const rawAttempts = response.headers.get("X-Tagium-Tunnel-Attempts");
  if (
    outcome !== "ready" &&
    outcome !== "recovered" &&
    outcome !== "exhausted" &&
    outcome !== "non_retryable"
  ) {
    return undefined;
  }
  if (!rawAttempts || !/^\d+$/.test(rawAttempts)) return undefined;

  const attempts = Number(rawAttempts);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_TUNNEL_ATTEMPTS) {
    return undefined;
  }

  return {
    type: "tunnel-readiness",
    outcome,
    attempts,
    elapsedBucket: tunnelElapsedBucket(elapsedMs),
  };
};

const decodeCobaltDownloadPlan = Effect.fn("decodeCobaltDownloadPlan")(function* (input: unknown) {
  return yield* decodeCobaltDownloadPlanEffect(input).pipe(
    Effect.mapError(
      (cause) =>
        new AudioDecodeError({
          message: "malformed cobalt audio plan.",
          cause,
        }),
    ),
  );
});

const makeCobaltAudio = Effect.fn("makeCobaltAudio")(function* () {
  const localAudioProcessor = yield* LocalAudioProcessor;

  const fetchPlan = (request: CobaltAudioDownloadRequest) =>
    Effect.tryPromise({
      try: async () => {
        const headers = new Headers({
          Accept: "application/json",
          "Content-Type": "application/json",
        });
        headers.set("X-Tagium-Request-Id", crypto.randomUUID());
        if (request.importId) {
          headers.set("X-Tagium-Import-Id", request.importId);
        }
        if (request.trackIndex !== undefined) {
          headers.set("X-Tagium-Track-Index", String(request.trackIndex));
        }
        const body: CobaltAudioRequestBody = {
          url: request.sourceUrl,
          audioBitrate: request.audioBitrate,
          audioFormat: request.audioFormat,
        };
        if (request.year !== undefined) body.year = request.year;
        const response = await fetch("/api/cobalt/audio", {
          method: "POST",
          headers,
          signal: request.signal,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        return await response.json();
      },
      catch: toPublicAudioError,
    }).pipe(
      Effect.flatMap((responseJson) => decodeCobaltDownloadPlan(responseJson)),
      Effect.mapError(toPublicAudioError),
      Effect.mapError((error) => new ImportStageError("plan", error)),
    );

  const fetchTunnelFile = (
    url: string,
    filename: string,
    lastModified: number,
    onLifecycle?: CobaltAudioDownloadLifecycleCallback,
    signal?: AbortSignal,
  ) =>
    Effect.tryPromise({
      try: async () => {
        await cobaltDownloadScheduler.waitForTunnelStart({
          signal,
          onWaitChange: (waiting) =>
            onLifecycle?.({
              type: waiting ? "tunnel-budget-wait-started" : "tunnel-budget-wait-ended",
            }),
        });

        const startedAt = Date.now();
        const response = await fetch(url, { signal });
        const readiness = tunnelReadinessFromResponse(response, Date.now() - startedAt);
        if (readiness) {
          onLifecycle?.(readiness);
        }
        if (!response.ok) {
          throw new Error(await response.text());
        }

        let contentType = response.headers.get("Content-Type");
        if (!contentType) {
          contentType = "application/octet-stream";
        }
        const blob = await response.blob();
        if (blob.size === 0) {
          throw new Error("cobalt tunnel response was empty.");
        }

        return new File([blob], filename, {
          type: contentType,
          lastModified,
        });
      },
      catch: (error) => new ImportStageError("tunnel", toPublicAudioError(error)),
    });

  const runDownload = (request: CobaltAudioDownloadRequest) =>
    Effect.gen(function* () {
      const plan = yield* fetchPlan(request);
      const lastModified = getStableLastModified(request.sourceUrl);

      if (plan.status === "local-processing") {
        return yield* localAudioProcessor
          .processLocalAudio({
            plan,
            lastModified,
            fetchTunnelFile: (url, filename) =>
              fetchTunnelFile(url, filename, lastModified, request.onLifecycle, request.signal),
            signal: request.signal,
          })
          .pipe(
            Effect.mapError((error) =>
              error instanceof ImportStageError ? error : new ImportStageError("processing", error),
            ),
          );
      }

      return yield* fetchTunnelFile(
        plan.url,
        plan.filename,
        lastModified,
        request.onLifecycle,
        request.signal,
      );
    });

  return CobaltAudio.of({
    download: (request) =>
      Effect.tryPromise({
        try: () =>
          cobaltDownloadScheduler.schedule(
            () => Effect.runPromise(runDownload(request)),
            request.signal,
          ),
        catch: toPublicAudioError,
      }).pipe(Effect.mapError(toPublicAudioError)),
  });
});

export class CobaltAudio extends Context.Service<
  CobaltAudio,
  {
    readonly download: (request: CobaltAudioDownloadRequest) => Effect.Effect<File, Error>;
  }
>()("CobaltAudio") {}

export const CobaltAudioLive = Layer.effect(CobaltAudio, makeCobaltAudio()).pipe(
  Layer.provide(LocalAudioProcessorLive),
);
