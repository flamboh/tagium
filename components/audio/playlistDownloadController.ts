import type { QueuedDownloadTrack } from "./downloadTrack";
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
} from "./playlistDownloadQueueRuntime";
import type {
  PlaylistDownloadQueueRun as PlaylistDownloadQueueRuntimeRun,
  PlaylistDownloadQueueRuntimeSnapshot,
} from "./playlistDownloadQueueRuntime";
import type { TagiumFile } from "./types";

export type PlaylistDownloadControllerSnapshot = PlaylistDownloadQueueRuntimeSnapshot;

export interface PlaylistDownloadController {
  enqueue: (tracks: QueuedDownloadTrack[]) => void;
  cancel: () => void;
  retry: () => void;
  getSnapshot: () => PlaylistDownloadControllerSnapshot | null;
  dispose: () => void;
}

export interface PlaylistDownloadControllerDeps {
  concurrency: number;
  now: () => number;
  setTimeout: (callback: () => void, waitMs: number) => unknown;
  clearTimeout: (timeout: unknown) => void;
  downloadAudio: (
    request: QueuedDownloadTrack["downloadRequest"] & { signal: AbortSignal },
  ) => Promise<File>;
  hydrateDownloadedTrack: (input: {
    fileId: string;
    downloadedFile: File;
    signal: AbortSignal;
  }) => Promise<void>;
  getFiles: () => TagiumFile[];
  markDownloadsQueued: (tracks: QueuedDownloadTrack[]) => void;
  markDownloadsCanceled: (trackIds: string[]) => void;
  markDownloadError: (fileId: string, error: unknown) => void;
  onSnapshot: (snapshot: PlaylistDownloadControllerSnapshot | null) => void;
}

type PlaylistDownloadControllerRun = PlaylistDownloadQueueRuntimeRun<QueuedDownloadTrack> & {
  budgetWakeTimeout?: unknown;
  abortControllers: Map<string, AbortController>;
};

const createPlaylistDownloadAbortReason = () =>
  new DOMException("playlist download canceled.", "AbortError");

const isPlaylistDownloadAbort = (error: unknown) => {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
};

const createPlaylistDownloadModelTrack = (track: QueuedDownloadTrack) => ({
  id: track.fileId,
  title: track.title,
  sourceUrl: track.downloadRequest.sourceUrl,
});

export const createPlaylistDownloadController = (
  deps: PlaylistDownloadControllerDeps,
): PlaylistDownloadController => {
  let currentRun: PlaylistDownloadControllerRun | null = null;
  let currentSnapshot: PlaylistDownloadControllerSnapshot | null = null;
  let nextRunId = 0;
  let disposed = false;

  const publish = (run: PlaylistDownloadControllerRun) => {
    if (disposed) return;
    if (currentRun !== run) return;

    currentSnapshot = derivePlaylistDownloadQueueState(run, deps.now());
    deps.onSnapshot(currentSnapshot);
  };

  const replaceSnapshot = (snapshot: PlaylistDownloadControllerSnapshot) => {
    if (disposed) return;

    currentSnapshot = snapshot;
    deps.onSnapshot(snapshot);
  };

  const clearBudgetWake = (run: PlaylistDownloadControllerRun) => {
    if (run.budgetWakeTimeout === undefined) return;

    deps.clearTimeout(run.budgetWakeTimeout);
    run.budgetWakeTimeout = undefined;
  };

  const scheduleBudgetWake = (run: PlaylistDownloadControllerRun, waitMs: number) => {
    clearBudgetWake(run);
    run.budgetWakeTimeout = deps.setTimeout(() => {
      run.budgetWakeTimeout = undefined;
      pump(run);
    }, waitMs);
  };

  const cancelPending = (run: PlaylistDownloadControllerRun) => {
    if (run.pending.length === 0) return;

    const canceledTrackIds = cancelPendingPlaylistDownloadTracks(run, deps.now());
    deps.markDownloadsCanceled(canceledTrackIds);
  };

  const cancelActive = (run: PlaylistDownloadControllerRun) => {
    if (run.active.length === 0) return;

    const canceledTrackIds = cancelActivePlaylistDownloadTracks(run, deps.now());
    for (const trackId of canceledTrackIds) {
      run.abortControllers.get(trackId)?.abort(createPlaylistDownloadAbortReason());
    }
    deps.markDownloadsCanceled(canceledTrackIds);
  };

  const finishIfIdle = (run: PlaylistDownloadControllerRun) => {
    if (!finishPlaylistDownloadQueueRunIfIdle(run)) return false;

    clearBudgetWake(run);
    publish(run);
    return true;
  };

  const startManagedDownload = (run: PlaylistDownloadControllerRun, track: QueuedDownloadTrack) => {
    const startedAt = deps.now();
    const abortController = new AbortController();
    run.abortControllers.set(track.fileId, abortController);
    markPlaylistDownloadTrackActive(run, track, startedAt);
    publish(run);

    void (async () => {
      try {
        const currentFile = deps.getFiles().find((file) => file.id === track.fileId);
        if (!currentFile) {
          markPlaylistDownloadTrackCompleted(run, track.fileId, deps.now());
          return;
        }

        const downloadedFile = await deps.downloadAudio({
          ...track.downloadRequest,
          signal: abortController.signal,
        });
        abortController.signal.throwIfAborted();
        if (currentRun !== run) return;

        await deps.hydrateDownloadedTrack({
          fileId: track.fileId,
          downloadedFile,
          signal: abortController.signal,
        });
        abortController.signal.throwIfAborted();
        if (currentRun !== run) return;

        markPlaylistDownloadTrackCompleted(run, track.fileId, deps.now());
      } catch (error) {
        if (isPlaylistDownloadAbort(error)) {
          markPlaylistDownloadTrackCanceled(run, track.fileId, deps.now());
          if (currentRun === run && !disposed) {
            deps.markDownloadsCanceled([track.fileId]);
          }
          return;
        }

        let message = "download failed.";
        if (error instanceof Error) {
          message = error.message;
        }
        markPlaylistDownloadTrackFailed(run, track.fileId, message, deps.now());
        if (currentRun === run && !disposed) {
          deps.markDownloadError(track.fileId, error);
        }
      } finally {
        run.abortControllers.delete(track.fileId);
        removeActivePlaylistDownloadTrack(run, track.fileId);
        if (currentRun === run && !disposed) {
          publish(run);
          pump(run);
        }
      }
    })();
  };

  const pump = (run: PlaylistDownloadControllerRun) => {
    if (disposed) return;
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
    while (run.active.length < deps.concurrency && run.pending.length > 0) {
      const budget = reserveNextPlaylistDownloadTrack(run, deps.now());

      if (budget.status === "waiting-for-tunnel-budget") {
        scheduleBudgetWake(run, budget.waitMs);
        publish(run);
        return;
      }

      if (budget.status === "reserved") {
        startManagedDownload(run, budget.track);
      }
    }

    finishIfIdle(run);
  };

  const enqueue = (tracks: QueuedDownloadTrack[]) => {
    if (disposed) return;
    if (tracks.length === 0) return;

    if (currentRun && !currentRun.done && !currentRun.canceled) {
      const fileErrorTrackIds = new Set(
        deps
          .getFiles()
          .filter((file) => file.status === "error")
          .map((file) => file.id),
      );
      const queuedTracks = enqueuePlaylistDownloadQueueTracks(
        currentRun,
        tracks,
        deps.now(),
        fileErrorTrackIds,
        createPlaylistDownloadModelTrack,
      );
      if (queuedTracks.length === 0) return;

      deps.markDownloadsQueued(queuedTracks);
      publish(currentRun);
      pump(currentRun);
      return;
    }

    const run: PlaylistDownloadControllerRun = {
      ...createPlaylistDownloadQueueRun(
        nextRunId + 1,
        tracks,
        deps.now(),
        createPlaylistDownloadModelTrack,
      ),
      abortControllers: new Map(),
    };
    nextRunId = run.id;
    currentRun = run;
    deps.markDownloadsQueued(tracks);
    replaceSnapshot(derivePlaylistDownloadQueueState(run, deps.now()));
    pump(run);
  };

  const cancel = () => {
    const run = currentRun;
    if (!run) return;
    if (run.done) return;

    run.canceled = true;
    cancelActive(run);
    publish(run);
    pump(run);
  };

  const retry = () => {
    const snapshot = currentSnapshot;
    if (!snapshot) return;
    if (snapshot.active.length > 0) return;

    const trackIdSet = new Set(snapshot.trackIds);
    const tracksToRetry = deps
      .getFiles()
      .filter((file) => trackIdSet.has(file.id) && !file.file)
      .map((file) => {
        if (!file.downloadRequest) return null;
        return {
          fileId: file.id,
          title: file.metadata?.title || file.filename,
          downloadRequest: file.downloadRequest,
        };
      })
      .filter((track): track is QueuedDownloadTrack => Boolean(track));
    enqueue(tracksToRetry);
  };

  const dispose = () => {
    disposed = true;
    const run = currentRun;
    if (!run) return;

    clearBudgetWake(run);
    for (const abortController of run.abortControllers.values()) {
      abortController.abort(createPlaylistDownloadAbortReason());
    }
  };

  return {
    enqueue,
    cancel,
    retry,
    getSnapshot: () => currentSnapshot,
    dispose,
  };
};
