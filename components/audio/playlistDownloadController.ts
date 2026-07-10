import { Cause, Effect, Exit, Fiber } from "effect";
import {
  cancelActivePlaylistDownloadTracks,
  cancelPendingPlaylistDownloadTracks,
  createPlaylistDownloadQueueRun,
  derivePlaylistDownloadQueueState,
  enqueuePlaylistDownloadQueueTracks,
  finishPlaylistDownloadQueueRunIfIdle,
  markPlaylistDownloadTrackActive,
  markPlaylistDownloadTrackCanceled,
  markPlaylistDownloadTrackCompleted,
  markPlaylistDownloadTrackFailed,
  removeActivePlaylistDownloadTrack,
  reserveNextPlaylistDownloadTrack,
  type PlaylistDownloadQueueRun,
  type PlaylistDownloadQueueRuntimeSnapshot,
  type PlaylistDownloadRuntimeTrack,
} from "./playlistDownloadQueueRuntime";
import type { PlaylistDownloadQueueTrack as PlaylistDownloadQueueModelTrack } from "./playlistDownloadQueue";

export const PLAYLIST_DOWNLOAD_CONCURRENCY = 3;

type PlaylistDownloadControllerRun<Track extends PlaylistDownloadRuntimeTrack> =
  PlaylistDownloadQueueRun<Track> & {
    activeFibers: Map<string, Fiber.Fiber<void, unknown>>;
    budgetWakeFiber?: Fiber.Fiber<void>;
  };

export type PlaylistDownloadControllerSnapshot = PlaylistDownloadQueueRuntimeSnapshot;

export interface PlaylistDownloadTrackSettled<Track extends PlaylistDownloadRuntimeTrack> {
  track: Track;
  outcome: "completed" | "failed" | "canceled";
  error?: unknown;
}

export type PlaylistDownloadControllerAction<Track extends PlaylistDownloadRuntimeTrack> =
  | {
      type: "cancel_requested";
      snapshot: PlaylistDownloadControllerSnapshot;
    }
  | {
      type: "retry_started";
      tracks: Track[];
      previousSnapshot: PlaylistDownloadControllerSnapshot;
    };

export interface PlaylistDownloadControllerDeps<Track extends PlaylistDownloadRuntimeTrack> {
  createModelTrack: (track: Track) => PlaylistDownloadQueueModelTrack;
  downloadTrack: (track: Track) => Effect.Effect<File, unknown>;
  hydrateTrack: (track: Track, downloadedFile: File) => Effect.Effect<void, unknown>;
  hasTrack: (trackId: string) => boolean;
  getFileErrorTrackIds: () => Set<string>;
  markQueued: (tracks: Track[]) => void;
  markCanceled: (trackIds: string[]) => void;
  markFailed: (trackId: string, error: unknown) => void;
  onTrackSettled?: (event: PlaylistDownloadTrackSettled<Track>) => void;
  onAction?: (event: PlaylistDownloadControllerAction<Track>) => void;
  emitSnapshot: (snapshot: PlaylistDownloadControllerSnapshot) => void;
  now?: () => number;
}

export interface PlaylistDownloadController<Track extends PlaylistDownloadRuntimeTrack> {
  enqueue: (tracks: Track[]) => void;
  cancel: () => void;
  retry: (tracks: Track[]) => void;
  getSnapshot: () => PlaylistDownloadControllerSnapshot | null;
}

const isPlaylistDownloadAbort = (error: unknown) => {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return "download failed.";
};

const firstCauseError = (cause: Cause.Cause<unknown>) => {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) return reason.error;
    if (Cause.isDieReason(reason)) return reason.defect;
  }
  return cause;
};

export const createPlaylistDownloadController = <Track extends PlaylistDownloadRuntimeTrack>(
  deps: PlaylistDownloadControllerDeps<Track>,
): PlaylistDownloadController<Track> => {
  let currentRun: PlaylistDownloadControllerRun<Track> | null = null;
  let nextRunId = 0;
  let currentSnapshot: PlaylistDownloadControllerSnapshot | null = null;
  const now = deps.now ?? (() => Date.now());

  const createSnapshot = (run: PlaylistDownloadControllerRun<Track>) =>
    derivePlaylistDownloadQueueState(run, now());

  const publish = (run: PlaylistDownloadControllerRun<Track>) => {
    if (currentRun !== run) return;
    currentSnapshot = createSnapshot(run);
    deps.emitSnapshot(currentSnapshot);
  };

  const clearBudgetWake = (run: PlaylistDownloadControllerRun<Track>) => {
    if (run.budgetWakeFiber === undefined) return;
    Effect.runFork(Fiber.interrupt(run.budgetWakeFiber));
    run.budgetWakeFiber = undefined;
  };

  const scheduleBudgetWake = (run: PlaylistDownloadControllerRun<Track>, waitMs: number) => {
    clearBudgetWake(run);
    run.budgetWakeFiber = Effect.runFork(
      Effect.gen(function* () {
        yield* Effect.sleep(waitMs);
        yield* Effect.sync(() => {
          if (currentRun !== run) return;
          run.budgetWakeFiber = undefined;
          pump(run);
        });
      }),
    );
  };

  const finishIfIdle = (run: PlaylistDownloadControllerRun<Track>) => {
    if (!finishPlaylistDownloadQueueRunIfIdle(run)) return false;
    clearBudgetWake(run);
    publish(run);
    return true;
  };

  const cancelPending = (run: PlaylistDownloadControllerRun<Track>) => {
    if (run.pending.length === 0) return;
    const pendingTracks = [...run.pending];
    const canceledTrackIds = cancelPendingPlaylistDownloadTracks(run, now());
    deps.markCanceled(canceledTrackIds);
    for (const track of pendingTracks) {
      deps.onTrackSettled?.({ track, outcome: "canceled" });
    }
  };

  const cancelActive = (run: PlaylistDownloadControllerRun<Track>) => {
    if (run.active.length === 0) return;
    const canceledTrackIds = cancelActivePlaylistDownloadTracks(run, now());
    for (const trackId of canceledTrackIds) {
      const fiber = run.activeFibers.get(trackId);
      if (fiber) {
        Effect.runFork(Fiber.interrupt(fiber));
      }
    }
    deps.markCanceled(canceledTrackIds);
  };

  const runDownloadEffect = (run: PlaylistDownloadControllerRun<Track>, track: Track) =>
    Effect.gen(function* () {
      if (!deps.hasTrack(track.fileId)) {
        yield* Effect.sync(() => {
          markPlaylistDownloadTrackCanceled(run, track.fileId, now());
          deps.markCanceled([track.fileId]);
          deps.onTrackSettled?.({ track, outcome: "canceled" });
        });
        return;
      }

      const downloadedFile = yield* deps.downloadTrack(track);
      if (currentRun !== run) return;

      yield* deps.hydrateTrack(track, downloadedFile);
      if (currentRun !== run) return;

      yield* Effect.sync(() => {
        markPlaylistDownloadTrackCompleted(run, track.fileId, now());
        deps.onTrackSettled?.({ track, outcome: "completed" });
      });
    });

  const handleDownloadExit = (
    run: PlaylistDownloadControllerRun<Track>,
    track: Track,
    exit: Exit.Exit<void, unknown>,
  ) => {
    run.activeFibers.delete(track.fileId);

    if (Exit.isFailure(exit)) {
      const error = firstCauseError(exit.cause);
      if (Exit.hasInterrupts(exit) || isPlaylistDownloadAbort(error)) {
        markPlaylistDownloadTrackCanceled(run, track.fileId, now());
        deps.onTrackSettled?.({ track, outcome: "canceled" });
        if (currentRun === run) {
          deps.markCanceled([track.fileId]);
        }
      } else {
        markPlaylistDownloadTrackFailed(run, track.fileId, toErrorMessage(error), now());
        deps.onTrackSettled?.({ track, outcome: "failed", error });
        if (currentRun === run) {
          deps.markFailed(track.fileId, error);
        }
      }
    }

    removeActivePlaylistDownloadTrack(run, track.fileId);
    publish(run);
    pump(run);
  };

  const startDownload = (run: PlaylistDownloadControllerRun<Track>, track: Track) => {
    markPlaylistDownloadTrackActive(run, track, now());
    publish(run);

    const fiber = Effect.runFork(runDownloadEffect(run, track));
    run.activeFibers.set(track.fileId, fiber);
    fiber.addObserver((exit) => handleDownloadExit(run, track, exit));
  };

  const pump = (run: PlaylistDownloadControllerRun<Track>) => {
    if (currentRun !== run) return;
    if (run.done) return;

    if (run.canceled) {
      clearBudgetWake(run);
      cancelPending(run);
      cancelActive(run);
      publish(run);
      finishIfIdle(run);
      return;
    }

    clearBudgetWake(run);
    while (run.active.length < PLAYLIST_DOWNLOAD_CONCURRENCY && run.pending.length > 0) {
      const budget = reserveNextPlaylistDownloadTrack(run, now());
      if (budget.status === "waiting-for-tunnel-budget") {
        scheduleBudgetWake(run, budget.waitMs);
        publish(run);
        return;
      }

      if (budget.status === "reserved") {
        startDownload(run, budget.track);
      }
    }

    finishIfIdle(run);
  };

  const enqueue = (tracks: Track[]) => {
    if (tracks.length === 0) return [];

    if (currentRun && !currentRun.done && !currentRun.canceled) {
      const queuedTracks = enqueuePlaylistDownloadQueueTracks(
        currentRun,
        tracks,
        now(),
        deps.getFileErrorTrackIds(),
        deps.createModelTrack,
      );
      if (queuedTracks.length === 0) return [];

      deps.markQueued(queuedTracks);
      publish(currentRun);
      pump(currentRun);
      return queuedTracks;
    }

    const run: PlaylistDownloadControllerRun<Track> = {
      ...createPlaylistDownloadQueueRun(++nextRunId, tracks, now(), deps.createModelTrack),
      activeFibers: new Map(),
    };
    currentRun = run;
    deps.markQueued(tracks);
    publish(run);
    pump(run);
    return tracks;
  };

  return {
    enqueue: (tracks) => {
      enqueue(tracks);
    },
    cancel: () => {
      if (!currentRun) return;
      if (currentRun.done) return;

      deps.onAction?.({ type: "cancel_requested", snapshot: createSnapshot(currentRun) });
      currentRun.canceled = true;
      cancelActive(currentRun);
      publish(currentRun);
      pump(currentRun);
    },
    retry: (tracks) => {
      const previousSnapshot = currentSnapshot;
      const queuedTracks = enqueue(tracks);
      if (!previousSnapshot || queuedTracks.length === 0) return;
      deps.onAction?.({ type: "retry_started", tracks: queuedTracks, previousSnapshot });
    },
    getSnapshot: () => currentSnapshot,
  };
};
