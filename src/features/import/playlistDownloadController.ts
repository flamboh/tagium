import { Cause, Effect, Exit, Fiber } from "effect";
import { toPublicAudioError } from "@/features/audio/audioErrors";
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
  removePlaylistDownloadTracks,
  reserveNextPlaylistDownloadTrack,
  type ActivePlaylistDownload,
  type PlaylistDownloadQueueRun,
  type PlaylistDownloadQueueRuntimeSnapshot,
  type PlaylistDownloadRuntimeTrack,
} from "@/features/import/playlistDownloadQueueRuntime";
import type { PlaylistDownloadQueueTrack as PlaylistDownloadQueueModelTrack } from "@/features/import/playlistDownloadQueue";
import { createDownloadAdmissionWindow } from "@/shared/cobalt/downloadAdmissionWindow";
import {
  importFailureStageFromDownloadError,
  ImportStageError,
  type ImportTrackOutcome,
} from "@/features/import/importLifecycle";
import type { ImportFailureStage, ImportOutcome } from "@/analytics";

export const PLAYLIST_DOWNLOAD_CONCURRENCY = 3;

type PlaylistDownloadControllerRun<Track extends PlaylistDownloadRuntimeTrack> =
  PlaylistDownloadQueueRun<Track> & {
    activeFibers: Map<ActivePlaylistDownload, Fiber.Fiber<void, unknown>>;
    currentExecutions: Map<string, ActivePlaylistDownload>;
    budgetWakeFiber?: Fiber.Fiber<void>;
  };

export type PlaylistDownloadControllerSnapshot = PlaylistDownloadQueueRuntimeSnapshot;

export type PlaylistDownloadTrackSettled<Track extends PlaylistDownloadRuntimeTrack> =
  | { track: Track; outcome: "completed" | "canceled" }
  | {
      track: Track;
      outcome: "failed";
      error: Error;
      failureStage: ImportFailureStage;
    };

export type PlaylistDownloadControllerAction<Track extends PlaylistDownloadRuntimeTrack> =
  | {
      type: "cancel_requested";
      snapshot: PlaylistDownloadControllerSnapshot;
    }
  | {
      type: "retry_started";
      retryAttemptId: number;
      tracks: Track[];
      previousSnapshot: PlaylistDownloadControllerSnapshot;
    }
  | {
      type: "retry_finished";
      retryAttemptId: number;
      tracks: Track[];
      retryCount: number;
      completedCount: number;
      failedCount: number;
      canceledCount: number;
      outcome: ImportOutcome;
      durationMs: number;
    };

export interface PlaylistDownloadControllerDeps<Track extends PlaylistDownloadRuntimeTrack> {
  createModelTrack: (track: Track) => PlaylistDownloadQueueModelTrack;
  downloadTrack: (track: Track) => Effect.Effect<File, unknown>;
  hydrateTrack: (track: Track, downloadedFile: File) => Effect.Effect<void, unknown>;
  hasTrack: (trackId: string) => boolean;
  getFileErrorTrackIds: () => Set<string>;
  markQueued: (tracks: Track[]) => void;
  markCanceled: (trackIds: string[]) => void;
  markFailed: (trackId: string, error: Error) => void;
  onTrackSettled?: (event: PlaylistDownloadTrackSettled<Track>) => void;
  onAction?: (event: PlaylistDownloadControllerAction<Track>) => void;
  emitSnapshot: (snapshot: PlaylistDownloadControllerSnapshot) => void;
  now?: () => number;
}

export interface PlaylistDownloadController<Track extends PlaylistDownloadRuntimeTrack> {
  enqueue: (tracks: Track[]) => void;
  cancel: () => void;
  remove: (trackIds: string[]) => void;
  retry: (tracks: Track[]) => void;
  getSnapshot: () => PlaylistDownloadControllerSnapshot | null;
}

const isPlaylistDownloadAbort = (error: Error): boolean => {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    if (error.cause !== undefined) return isPlaylistDownloadAbort(toPublicAudioError(error.cause));
  }
  return false;
};

const toErrorMessage = (error: Error) => error.message || "download failed.";

const firstCauseError = (cause: Cause.Cause<unknown>): Error => {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) return toPublicAudioError(reason.error);
    if (Cause.isDieReason(reason)) return toPublicAudioError(reason.defect);
  }
  return new Error(Cause.pretty(cause));
};

class StagedDownloadFailure extends Error {
  readonly stage: ImportFailureStage;

  constructor(stage: ImportFailureStage, cause: Error) {
    super(cause.message, { cause });
    this.name = "StagedDownloadFailure";
    this.stage = stage;
  }
}

const retryOutcomeFrom = (counts: {
  completedCount: number;
  failedCount: number;
  canceledCount: number;
}): ImportOutcome => {
  if (counts.canceledCount > 0) return "canceled";
  if (counts.failedCount === 0) return "completed";
  if (counts.completedCount > 0) return "partial";
  return "failed";
};

export const createPlaylistDownloadController = <Track extends PlaylistDownloadRuntimeTrack>(
  deps: PlaylistDownloadControllerDeps<Track>,
): PlaylistDownloadController<Track> => {
  let currentRun: PlaylistDownloadControllerRun<Track> | null = null;
  let nextRunId = 0;
  let currentSnapshot: PlaylistDownloadControllerSnapshot | null = null;
  let nextRetryAttemptId = 0;
  const retryAttempts = new Map<
    number,
    {
      runId: number;
      tracks: Track[];
      trackIds: Set<string>;
      outcomes: Map<string, ImportTrackOutcome>;
      startedAt: number;
    }
  >();
  const pendingRetryAttemptIds = new Map<number, Map<string, number>>();
  const downloadAdmission = createDownloadAdmissionWindow();
  const now = deps.now ?? (() => Date.now());

  const notifyTrackSettled = (
    run: PlaylistDownloadControllerRun<Track>,
    event: PlaylistDownloadTrackSettled<Track>,
    retryAttemptId?: number,
  ) => {
    deps.onTrackSettled?.(event);
    if (retryAttemptId === undefined) return;

    const attempt = retryAttempts.get(retryAttemptId);
    if (!attempt || attempt.runId !== run.id) return;
    if (!attempt.trackIds.has(event.track.fileId)) return;
    if (attempt.outcomes.has(event.track.fileId)) return;
    attempt.outcomes.set(event.track.fileId, event.outcome);
    if (attempt.outcomes.size !== attempt.trackIds.size) return;

    let completedCount = 0;
    let failedCount = 0;
    let canceledCount = 0;
    for (const outcome of attempt.outcomes.values()) {
      if (outcome === "completed") completedCount += 1;
      if (outcome === "failed") failedCount += 1;
      if (outcome === "canceled") canceledCount += 1;
    }
    retryAttempts.delete(retryAttemptId);
    const counts = { completedCount, failedCount, canceledCount };
    deps.onAction?.({
      type: "retry_finished",
      retryAttemptId,
      tracks: attempt.tracks,
      retryCount: attempt.trackIds.size,
      ...counts,
      outcome: retryOutcomeFrom(counts),
      durationMs: Math.max(0, now() - attempt.startedAt),
    });
  };

  const takePendingRetryAttemptIdFor = (
    run: PlaylistDownloadControllerRun<Track>,
    trackId: string,
  ) => {
    const runAttempts = pendingRetryAttemptIds.get(run.id);
    const retryAttemptId = runAttempts?.get(trackId);
    runAttempts?.delete(trackId);
    if (runAttempts?.size === 0) pendingRetryAttemptIds.delete(run.id);
    return retryAttemptId;
  };

  const isCurrentExecution = (
    run: PlaylistDownloadControllerRun<Track>,
    trackId: string,
    execution: ActivePlaylistDownload,
  ) => run.currentExecutions.get(trackId) === execution;

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
      notifyTrackSettled(
        run,
        { track, outcome: "canceled" },
        takePendingRetryAttemptIdFor(run, track.fileId),
      );
    }
  };

  const cancelActive = (run: PlaylistDownloadControllerRun<Track>) => {
    if (run.active.length === 0) return;
    const canceledTrackIds = cancelActivePlaylistDownloadTracks(run, now());
    for (const execution of run.active) {
      const fiber = run.activeFibers.get(execution);
      if (fiber) {
        Effect.runFork(Fiber.interrupt(fiber));
      }
    }
    deps.markCanceled(canceledTrackIds);
  };

  const runDownloadEffect = (
    run: PlaylistDownloadControllerRun<Track>,
    track: Track,
    execution: ActivePlaylistDownload,
    retryAttemptId: number | undefined,
  ) =>
    Effect.gen(function* () {
      if (!isCurrentExecution(run, track.fileId, execution)) return;
      if (!deps.hasTrack(track.fileId)) {
        yield* Effect.sync(() => {
          if (!isCurrentExecution(run, track.fileId, execution)) return;
          markPlaylistDownloadTrackCanceled(run, track.fileId, now());
          deps.markCanceled([track.fileId]);
          notifyTrackSettled(run, { track, outcome: "canceled" }, retryAttemptId);
        });
        return;
      }

      const downloadedFile = yield* deps.downloadTrack(track).pipe(
        Effect.mapError((error) => {
          const failure = toPublicAudioError(error);
          return new StagedDownloadFailure(importFailureStageFromDownloadError(failure), failure);
        }),
      );
      if (currentRun !== run || !isCurrentExecution(run, track.fileId, execution)) return;

      yield* deps
        .hydrateTrack(track, downloadedFile)
        .pipe(
          Effect.mapError(
            (error) => new StagedDownloadFailure("hydration", toPublicAudioError(error)),
          ),
        );
      if (currentRun !== run || !isCurrentExecution(run, track.fileId, execution)) return;

      yield* Effect.sync(() => {
        if (!isCurrentExecution(run, track.fileId, execution)) return;
        markPlaylistDownloadTrackCompleted(run, track.fileId, now());
        notifyTrackSettled(run, { track, outcome: "completed" }, retryAttemptId);
      });
    });

  const handleDownloadExit = (
    run: PlaylistDownloadControllerRun<Track>,
    track: Track,
    execution: ActivePlaylistDownload,
    retryAttemptId: number | undefined,
    exit: Exit.Exit<void, unknown>,
  ) => {
    run.activeFibers.delete(execution);
    const executionIsCurrent = isCurrentExecution(run, track.fileId, execution);
    if (executionIsCurrent) run.currentExecutions.delete(track.fileId);
    const trackWasRemoved =
      !executionIsCurrent || !run.model.items.some((item) => item.id === track.fileId);

    if (Exit.isFailure(exit)) {
      const failure = firstCauseError(exit.cause);
      const stagedFailure =
        failure instanceof ImportStageError || failure instanceof StagedDownloadFailure
          ? failure
          : undefined;
      const error = stagedFailure ? toPublicAudioError(stagedFailure.cause) : failure;
      if (trackWasRemoved) {
        notifyTrackSettled(run, { track, outcome: "canceled" }, retryAttemptId);
      } else if (Exit.hasInterrupts(exit) || isPlaylistDownloadAbort(error)) {
        markPlaylistDownloadTrackCanceled(run, track.fileId, now());
        notifyTrackSettled(run, { track, outcome: "canceled" }, retryAttemptId);
        if (currentRun === run) {
          deps.markCanceled([track.fileId]);
        }
      } else {
        markPlaylistDownloadTrackFailed(run, track.fileId, toErrorMessage(error), now());
        notifyTrackSettled(
          run,
          {
            track,
            outcome: "failed",
            error,
            failureStage: stagedFailure?.stage ?? "plan",
          },
          retryAttemptId,
        );
        if (currentRun === run) {
          deps.markFailed(track.fileId, error);
        }
      }
    } else if (trackWasRemoved) {
      notifyTrackSettled(run, { track, outcome: "canceled" }, retryAttemptId);
    }

    run.active = run.active.filter((active) => active !== execution);
    publish(run);
    pump(run);
  };

  const startDownload = (run: PlaylistDownloadControllerRun<Track>, track: Track) => {
    const execution = markPlaylistDownloadTrackActive(run, track, now());
    run.currentExecutions.set(track.fileId, execution);
    const retryAttemptId = takePendingRetryAttemptIdFor(run, track.fileId);
    publish(run);

    const fiber = Effect.runFork(runDownloadEffect(run, track, execution, retryAttemptId));
    run.activeFibers.set(execution, fiber);
    fiber.addObserver((exit) => handleDownloadExit(run, track, execution, retryAttemptId, exit));
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
      const budget = reserveNextPlaylistDownloadTrack(run, downloadAdmission, now());
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

  const enqueue = (tracks: Track[], startImmediately = true) => {
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
      if (startImmediately) pump(currentRun);
      return queuedTracks;
    }

    const run: PlaylistDownloadControllerRun<Track> = {
      ...createPlaylistDownloadQueueRun(++nextRunId, tracks, now(), deps.createModelTrack),
      activeFibers: new Map(),
      currentExecutions: new Map(),
    };
    currentRun = run;
    deps.markQueued(tracks);
    publish(run);
    if (startImmediately) pump(run);
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
    remove: (trackIds) => {
      if (!currentRun || trackIds.length === 0) return;
      const run = currentRun;

      const removed = removePlaylistDownloadTracks(run, trackIds);
      if (removed.removedTrackIds.length === 0) return;

      for (const track of removed.pendingTracks) {
        notifyTrackSettled(
          run,
          { track, outcome: "canceled" },
          takePendingRetryAttemptIdFor(run, track.fileId),
        );
      }
      const removedActiveTrackIds = new Set(removed.activeTrackIds);
      for (const execution of run.active) {
        if (!removedActiveTrackIds.has(execution.fileId)) continue;
        if (isCurrentExecution(run, execution.fileId, execution)) {
          run.currentExecutions.delete(execution.fileId);
        }
        const fiber = run.activeFibers.get(execution);
        if (fiber) Effect.runFork(Fiber.interrupt(fiber));
      }

      publish(run);
      pump(run);
    },
    retry: (tracks) => {
      const previousSnapshot = currentSnapshot;
      const queuedTracks = enqueue(tracks, false);
      if (queuedTracks.length === 0 || !currentRun) return;
      const retryRun = currentRun;
      if (!previousSnapshot) {
        pump(retryRun);
        return;
      }
      const retryAttemptId = ++nextRetryAttemptId;
      retryAttempts.set(retryAttemptId, {
        runId: retryRun.id,
        tracks: queuedTracks,
        trackIds: new Set(queuedTracks.map((track) => track.fileId)),
        outcomes: new Map(),
        startedAt: now(),
      });
      const runPendingRetryAttemptIds =
        pendingRetryAttemptIds.get(retryRun.id) ?? new Map<string, number>();
      for (const track of queuedTracks) {
        runPendingRetryAttemptIds.set(track.fileId, retryAttemptId);
      }
      pendingRetryAttemptIds.set(retryRun.id, runPendingRetryAttemptIds);
      deps.onAction?.({
        type: "retry_started",
        retryAttemptId,
        tracks: queuedTracks,
        previousSnapshot,
      });
      pump(retryRun);
    },
    getSnapshot: () => currentSnapshot,
  };
};
