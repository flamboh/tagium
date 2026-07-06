import { Context, Effect, Layer } from "effect";
import { AudioDecodeError, toPublicAudioError } from "./audioErrors";
import { decodeCobaltDownloadPlanEffect } from "./cobaltAudioSchemas";
import { LocalAudioProcessor, LocalAudioProcessorLive } from "./localAudioProcessor";

export type AudioDownloadBitrate = "320" | "256" | "128" | "96" | "64";

export type CobaltAudioDownloadLifecycleEvent =
  | {
      type: "tunnel-budget-wait-started";
    }
  | {
      type: "tunnel-budget-wait-ended";
    };

export type CobaltAudioDownloadLifecycleCallback = (
  event: CobaltAudioDownloadLifecycleEvent,
) => void;

export interface CobaltAudioDownloadRequest {
  sourceUrl: string;
  audioBitrate: AudioDownloadBitrate;
  onLifecycle?: CobaltAudioDownloadLifecycleCallback;
  signal?: AbortSignal;
}

const MAX_CONCURRENT_COBALT_DOWNLOADS = 4;
const COBALT_TUNNEL_START_INTERVAL_MS = 1_600;
let activeCobaltDownloads = 0;
const pendingCobaltDownloads: (() => void)[] = [];
let nextCobaltTunnelStartAt = 0;
let cobaltTunnelStartQueue = Promise.resolve();
let waitingCobaltTunnelStarts = 0;

const delay = async (milliseconds: number, signal?: AbortSignal) => {
  signal?.throwIfAborted();

  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };

    timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

const reserveCobaltDownloadSlot = async (signal?: AbortSignal) => {
  signal?.throwIfAborted();

  if (activeCobaltDownloads < MAX_CONCURRENT_COBALT_DOWNLOADS) {
    activeCobaltDownloads += 1;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const resolveSlot = () => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        releaseCobaltDownloadSlot();
        reject(signal.reason);
        return;
      }
      resolve();
    };
    const onAbort = () => {
      const pendingIndex = pendingCobaltDownloads.indexOf(resolveSlot);
      if (pendingIndex >= 0) {
        pendingCobaltDownloads.splice(pendingIndex, 1);
      }
      reject(signal?.reason);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    pendingCobaltDownloads.push(resolveSlot);
  });
};

const releaseCobaltDownloadSlot = () => {
  const next = pendingCobaltDownloads.shift();
  if (next) {
    next();
    return;
  }

  activeCobaltDownloads -= 1;
};

const withCobaltDownloadSlot = <Value, Error, Requirements>(
  download: Effect.Effect<Value, Error, Requirements>,
  signal?: AbortSignal,
) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => reserveCobaltDownloadSlot(signal),
      catch: toPublicAudioError,
    }),
    () => download,
    () =>
      Effect.sync(() => {
        releaseCobaltDownloadSlot();
      }),
  );

const waitForCobaltTunnelStart = async (
  onLifecycle?: CobaltAudioDownloadLifecycleCallback,
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted();

  let releaseQueue = () => {};
  const previousQueue = cobaltTunnelStartQueue;
  cobaltTunnelStartQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  let isWaitingForBudget = false;
  waitingCobaltTunnelStarts += 1;

  try {
    if (waitingCobaltTunnelStarts > 1 || nextCobaltTunnelStartAt > Date.now()) {
      isWaitingForBudget = true;
      onLifecycle?.({ type: "tunnel-budget-wait-started" });
    }

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        signal?.removeEventListener("abort", onAbort);
        reject(signal?.reason);
      };

      previousQueue.then(
        () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
      signal?.addEventListener("abort", onAbort, { once: true });
    });

    signal?.throwIfAborted();

    const waitMs = nextCobaltTunnelStartAt - Date.now();
    if (waitMs > 0) {
      if (!isWaitingForBudget) {
        onLifecycle?.({ type: "tunnel-budget-wait-started" });
        isWaitingForBudget = true;
      }

      await delay(waitMs, signal);
    }

    signal?.throwIfAborted();
    nextCobaltTunnelStartAt = Date.now() + COBALT_TUNNEL_START_INTERVAL_MS;
  } finally {
    waitingCobaltTunnelStarts -= 1;
    releaseQueue();
    if (isWaitingForBudget) {
      onLifecycle?.({ type: "tunnel-budget-wait-ended" });
    }
  }
};

const getStableLastModified = (sourceUrl: string) =>
  Array.from(sourceUrl).reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) % 2_147_483_647;
  }, 1);

const decodeCobaltDownloadPlan = Effect.fn("decodeCobaltDownloadPlan")(function* (input: unknown) {
  return yield* decodeCobaltDownloadPlanEffect(input).pipe(
    Effect.mapError(
      (cause) =>
        new AudioDecodeError({
          message: "malformed Cobalt audio plan.",
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
        const response = await fetch("/api/cobalt/audio", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          signal: request.signal,
          body: JSON.stringify({
            url: request.sourceUrl,
            audioBitrate: request.audioBitrate,
          }),
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
        await waitForCobaltTunnelStart(onLifecycle, signal);

        const response = await fetch(url, { signal });
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
      catch: toPublicAudioError,
    });

  const runDownload = (request: CobaltAudioDownloadRequest) =>
    Effect.gen(function* () {
      const plan = yield* fetchPlan(request);
      const lastModified = getStableLastModified(request.sourceUrl);

      if (plan.status === "local-processing") {
        return yield* localAudioProcessor.processLocalAudio({
          plan,
          lastModified,
          fetchTunnelFile: (url, filename) =>
            fetchTunnelFile(url, filename, lastModified, request.onLifecycle, request.signal),
          signal: request.signal,
        });
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
      withCobaltDownloadSlot(runDownload(request), request.signal).pipe(
        Effect.mapError(toPublicAudioError),
      ),
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
