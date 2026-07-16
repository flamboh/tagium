import {
  createPlaylistDownloadQueue,
  createPlaylistDownloadQueueItem,
  derivePlaylistDownloadQueueSummary,
  markPlaylistDownloadActive,
  markPlaylistDownloadCanceled,
  markPlaylistDownloadCompleted,
  markPlaylistDownloadFailed,
  retryPlaylistDownloadItem,
} from "./playlistDownloadQueue";
import type { DownloadAdmissionWindow } from "./downloadAdmissionWindow";
import type {
  PlaylistDownloadQueueState as PlaylistDownloadQueueModel,
  PlaylistDownloadQueueTrack as PlaylistDownloadQueueModelTrack,
} from "./playlistDownloadQueue";

export type PlaylistDownloadRuntimeTrack = {
  fileId: string;
  title: string;
};

export type ActivePlaylistDownload = {
  fileId: string;
  title: string;
  startedAt: number;
};

export type PlaylistDownloadQueueRun<
  Track extends PlaylistDownloadRuntimeTrack = PlaylistDownloadRuntimeTrack,
> = {
  id: number;
  trackIds: string[];
  pending: Track[];
  active: ActivePlaylistDownload[];
  total: number;
  completed: number;
  failed: number;
  startedAt: number;
  model: PlaylistDownloadQueueModel;
  canceled: boolean;
  done: boolean;
  waitingForTunnelBudget: boolean;
};

export type PlaylistDownloadQueueRuntimeSnapshot = {
  id: number;
  trackIds: string[];
  total: number;
  completed: number;
  failed: number;
  canceledCount: number;
  pending: number;
  active: ActivePlaylistDownload[];
  startedAt: number;
  etaMs?: number;
  canceled: boolean;
  done: boolean;
  waitingForTunnelBudget: boolean;
};

export type ReserveNextPlaylistDownloadResult<Track extends PlaylistDownloadRuntimeTrack> =
  | {
      status: "empty";
    }
  | {
      status: "reserved";
      track: Track;
    }
  | {
      status: "waiting-for-tunnel-budget";
      waitMs: number;
    };

export type RemovePlaylistDownloadTracksResult<Track extends PlaylistDownloadRuntimeTrack> = {
  removedTrackIds: string[];
  pendingTracks: Track[];
  activeTrackIds: string[];
};

export const createPlaylistDownloadQueueRun = <Track extends PlaylistDownloadRuntimeTrack>(
  id: number,
  tracks: Track[],
  startedAt: number,
  createModelTrack: (track: Track) => PlaylistDownloadQueueModelTrack,
): PlaylistDownloadQueueRun<Track> => ({
  id,
  trackIds: tracks.map((track) => track.fileId),
  pending: [...tracks],
  active: [],
  total: tracks.length,
  completed: 0,
  failed: 0,
  startedAt,
  model: createPlaylistDownloadQueue(tracks.map(createModelTrack)),
  canceled: false,
  done: false,
  waitingForTunnelBudget: false,
});

export const derivePlaylistDownloadQueueState = (
  run: PlaylistDownloadQueueRun,
  nowMs: number,
): PlaylistDownloadQueueRuntimeSnapshot => {
  const summary = derivePlaylistDownloadQueueSummary(run.model, nowMs);
  const queuedTrackIds = new Set(run.trackIds);

  return {
    id: run.id,
    trackIds: run.trackIds,
    total: run.total,
    completed: summary.completedCount,
    failed: summary.failedCount,
    canceledCount: summary.canceledCount,
    pending: summary.pendingCount,
    // Deleted active work remains internal until its fiber settles, preserving the concurrency cap.
    active: run.active.filter((track) => queuedTrackIds.has(track.fileId)),
    startedAt: run.startedAt,
    etaMs: summary.etaMs,
    canceled: run.canceled,
    done: run.done,
    waitingForTunnelBudget: !run.done && run.waitingForTunnelBudget,
  };
};

export const removePlaylistDownloadTracks = <Track extends PlaylistDownloadRuntimeTrack>(
  run: PlaylistDownloadQueueRun<Track>,
  trackIds: string[],
): RemovePlaylistDownloadTracksResult<Track> => {
  const requestedTrackIds = new Set(trackIds);
  const removedItems = run.model.items.filter((item) => requestedTrackIds.has(item.id));
  if (removedItems.length === 0) {
    return { removedTrackIds: [], pendingTracks: [], activeTrackIds: [] };
  }

  const removedTrackIds = new Set(removedItems.map((item) => item.id));
  const pendingTracks = run.pending.filter((track) => removedTrackIds.has(track.fileId));
  const activeTrackIds: string[] = [];
  for (const track of run.active) {
    if (removedTrackIds.has(track.fileId)) activeTrackIds.push(track.fileId);
  }

  run.pending = run.pending.filter((track) => !removedTrackIds.has(track.fileId));
  run.trackIds = run.trackIds.filter((trackId) => !removedTrackIds.has(trackId));
  run.model = {
    ...run.model,
    items: run.model.items.filter((item) => !removedTrackIds.has(item.id)),
  };
  run.total = run.model.items.length;
  run.completed -= removedItems.filter((item) => item.status === "completed").length;
  run.failed -= removedItems.filter((item) => item.status === "failed").length;

  return { removedTrackIds: [...removedTrackIds], pendingTracks, activeTrackIds };
};

export const enqueuePlaylistDownloadQueueTracks = <Track extends PlaylistDownloadRuntimeTrack>(
  run: PlaylistDownloadQueueRun<Track>,
  tracks: Track[],
  nowMs: number,
  fileErrorTrackIds: Set<string>,
  createModelTrack: (track: Track) => PlaylistDownloadQueueModelTrack,
) => {
  const retryTracks: Track[] = [];
  const newTracks: Track[] = [];

  for (const track of tracks) {
    const queueItem = run.model.items.find((item) => item.id === track.fileId);
    if (
      queueItem?.status === "failed" ||
      queueItem?.status === "canceled" ||
      (queueItem?.status === "completed" && fileErrorTrackIds.has(track.fileId))
    ) {
      retryTracks.push(track);
      if (queueItem.status === "failed") {
        run.failed -= 1;
      }
      if (queueItem.status === "completed") {
        run.completed -= 1;
        run.model = markPlaylistDownloadCanceled(run.model, track.fileId, nowMs);
      }
      run.model = retryPlaylistDownloadItem(run.model, track.fileId);
      continue;
    }

    if (!queueItem) {
      newTracks.push(track);
    }
  }

  const queuedTracks = [...retryTracks, ...newTracks];
  if (queuedTracks.length === 0) return queuedTracks;

  run.pending.push(...queuedTracks);
  run.trackIds = asUniqueTrackIds([...run.trackIds, ...newTracks.map((track) => track.fileId)]);
  run.total += newTracks.length;
  run.model = {
    ...run.model,
    items: [
      ...run.model.items,
      ...newTracks.map((track) => createPlaylistDownloadQueueItem(createModelTrack(track))),
    ],
  };

  return queuedTracks;
};

export const reserveNextPlaylistDownloadTrack = <Track extends PlaylistDownloadRuntimeTrack>(
  run: PlaylistDownloadQueueRun<Track>,
  admission: DownloadAdmissionWindow,
  nowMs: number,
): ReserveNextPlaylistDownloadResult<Track> => {
  const nextTrack = run.pending[0];
  if (!nextTrack) {
    run.waitingForTunnelBudget = false;
    return { status: "empty" };
  }

  const queueItem = run.model.items.find((item) => item.id === nextTrack.fileId);
  if (!queueItem) {
    throw new Error("playlist download item not found.");
  }
  const budget = admission.reserve(queueItem.tunnelCost, nowMs);

  if (budget.status === "waiting") {
    run.waitingForTunnelBudget = true;
    return {
      status: "waiting-for-tunnel-budget",
      waitMs: budget.waitMs,
    };
  }

  run.waitingForTunnelBudget = false;
  run.pending = run.pending.slice(1);
  return {
    status: "reserved",
    track: nextTrack,
  };
};

export const markPlaylistDownloadTrackActive = <Track extends PlaylistDownloadRuntimeTrack>(
  run: PlaylistDownloadQueueRun<Track>,
  track: Track,
  startedAt: number,
) => {
  const activeTrack = {
    fileId: track.fileId,
    title: track.title,
    startedAt,
  };
  run.model = markPlaylistDownloadActive(run.model, track.fileId, startedAt);
  run.active = [...run.active, activeTrack];
  return activeTrack;
};

export const markPlaylistDownloadTrackCompleted = (
  run: PlaylistDownloadQueueRun,
  trackId: string,
  nowMs: number,
) => {
  run.completed += 1;
  run.model = markPlaylistDownloadCompleted(run.model, trackId, nowMs);
};

export const markPlaylistDownloadTrackFailed = (
  run: PlaylistDownloadQueueRun,
  trackId: string,
  error: string,
  nowMs: number,
) => {
  run.failed += 1;
  run.model = markPlaylistDownloadFailed(run.model, trackId, error, nowMs);
};

export const markPlaylistDownloadTrackCanceled = (
  run: PlaylistDownloadQueueRun,
  trackId: string,
  nowMs: number,
) => {
  run.model = markPlaylistDownloadCanceled(run.model, trackId, nowMs);
};

export const removeActivePlaylistDownloadTrack = (
  run: PlaylistDownloadQueueRun,
  trackId: string,
) => {
  run.active = run.active.filter((track) => track.fileId !== trackId);
};

export const cancelPendingPlaylistDownloadTracks = (
  run: PlaylistDownloadQueueRun,
  nowMs: number,
) => {
  const canceledTrackIds = run.pending.map((track) => track.fileId);
  for (const trackId of canceledTrackIds) {
    run.model = markPlaylistDownloadCanceled(run.model, trackId, nowMs);
  }
  run.pending = [];
  run.waitingForTunnelBudget = false;
  return canceledTrackIds;
};

export const cancelActivePlaylistDownloadTracks = (
  run: PlaylistDownloadQueueRun,
  nowMs: number,
) => {
  const canceledTrackIds = run.active.map((track) => track.fileId);
  for (const trackId of canceledTrackIds) {
    run.model = markPlaylistDownloadCanceled(run.model, trackId, nowMs);
  }
  return canceledTrackIds;
};

export const finishPlaylistDownloadQueueRunIfIdle = (run: PlaylistDownloadQueueRun) => {
  if (run.active.length > 0) return false;
  if (!run.canceled && run.pending.length > 0) return false;

  run.done = true;
  run.waitingForTunnelBudget = false;
  return true;
};

const asUniqueTrackIds = (trackIds: string[]) => [...new Set(trackIds)];
