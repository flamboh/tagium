export type PlaylistDownloadQueueItemStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "canceled";

export interface PlaylistDownloadQueueTrack {
  id: string;
  title: string;
  sourceUrl: string;
  tunnelCost?: number;
}

export interface PlaylistDownloadQueueItem {
  id: string;
  title: string;
  sourceUrl: string;
  tunnelCost: number;
  status: PlaylistDownloadQueueItemStatus;
  attempts: number;
  startedAtMs?: number;
  completedAtMs?: number;
  failedAtMs?: number;
  canceledAtMs?: number;
  error?: string;
}

export interface PlaylistDownloadQueueState {
  items: PlaylistDownloadQueueItem[];
}

export interface PlaylistDownloadQueueSummary {
  label: string;
  totalCount: number;
  completedCount: number;
  activeCount: number;
  pendingCount: number;
  failedCount: number;
  canceledCount: number;
  activeTitles: string[];
  etaMs?: number;
}

export const createPlaylistDownloadQueueItem = (
  track: PlaylistDownloadQueueTrack,
): PlaylistDownloadQueueItem => {
  let tunnelCost = DEFAULT_DOWNLOAD_ADMISSION_COST;
  if (track.tunnelCost !== undefined) {
    tunnelCost = track.tunnelCost;
  }

  return {
    id: track.id,
    title: track.title,
    sourceUrl: track.sourceUrl,
    tunnelCost,
    status: "pending",
    attempts: 0,
  };
};

export const createPlaylistDownloadQueue = (
  tracks: PlaylistDownloadQueueTrack[],
): PlaylistDownloadQueueState => ({ items: tracks.map(createPlaylistDownloadQueueItem) });

export const markPlaylistDownloadActive = (
  queue: PlaylistDownloadQueueState,
  itemId: string,
  nowMs: number,
) =>
  updatePlaylistDownloadQueueItem(queue, itemId, (item) => ({
    ...item,
    status: "active",
    attempts: item.attempts + 1,
    startedAtMs: nowMs,
    completedAtMs: undefined,
    failedAtMs: undefined,
    canceledAtMs: undefined,
    error: undefined,
  }));

export const markPlaylistDownloadCompleted = (
  queue: PlaylistDownloadQueueState,
  itemId: string,
  nowMs: number,
) =>
  updatePlaylistDownloadQueueItem(queue, itemId, (item) => ({
    ...item,
    status: "completed",
    completedAtMs: nowMs,
    failedAtMs: undefined,
    canceledAtMs: undefined,
    error: undefined,
  }));

export const markPlaylistDownloadFailed = (
  queue: PlaylistDownloadQueueState,
  itemId: string,
  error: string,
  nowMs: number,
) =>
  updatePlaylistDownloadQueueItem(queue, itemId, (item) => ({
    ...item,
    status: "failed",
    failedAtMs: nowMs,
    canceledAtMs: undefined,
    error,
  }));

export const markPlaylistDownloadCanceled = (
  queue: PlaylistDownloadQueueState,
  itemId: string,
  nowMs: number,
) =>
  updatePlaylistDownloadQueueItem(queue, itemId, (item) => ({
    ...item,
    status: "canceled",
    failedAtMs: undefined,
    canceledAtMs: nowMs,
    error: undefined,
  }));

export const retryPlaylistDownloadItem = (queue: PlaylistDownloadQueueState, itemId: string) =>
  updatePlaylistDownloadQueueItem(queue, itemId, (item) => {
    if (item.status !== "failed" && item.status !== "canceled") {
      return item;
    }

    return {
      ...item,
      status: "pending",
      startedAtMs: undefined,
      completedAtMs: undefined,
      failedAtMs: undefined,
      canceledAtMs: undefined,
      error: undefined,
    };
  });

export const derivePlaylistDownloadQueueSummary = (
  queue: PlaylistDownloadQueueState,
  nowMs: number,
): PlaylistDownloadQueueSummary => {
  const activeItems = queue.items.filter((item) => item.status === "active");
  const pendingItems = queue.items.filter((item) => item.status === "pending");
  const completedCount = queue.items.filter((item) => item.status === "completed").length;
  const failedCount = queue.items.filter((item) => item.status === "failed").length;
  const canceledCount = queue.items.filter((item) => item.status === "canceled").length;
  return {
    label: `Downloading ${completedCount}/${queue.items.length}`,
    totalCount: queue.items.length,
    completedCount,
    activeCount: activeItems.length,
    pendingCount: pendingItems.length,
    failedCount,
    canceledCount,
    activeTitles: activeItems.map((item) => item.title),
    etaMs: estimatePlaylistDownloadQueueEtaMs(queue, nowMs),
  };
};

const updatePlaylistDownloadQueueItem = (
  queue: PlaylistDownloadQueueState,
  itemId: string,
  updateItem: (item: PlaylistDownloadQueueItem) => PlaylistDownloadQueueItem,
) => {
  let foundItem = false;
  const items = queue.items.map((item) => {
    if (item.id !== itemId) {
      return item;
    }

    foundItem = true;
    return updateItem(item);
  });

  if (!foundItem) {
    throw new Error("playlist download item not found.");
  }

  return {
    ...queue,
    items,
  };
};

const estimatePlaylistDownloadQueueEtaMs = (queue: PlaylistDownloadQueueState, nowMs: number) => {
  const completedDurations: number[] = [];
  for (const item of queue.items) {
    if (item.status !== "completed") {
      continue;
    }

    if (item.startedAtMs === undefined || item.completedAtMs === undefined) {
      continue;
    }

    const durationMs = item.completedAtMs - item.startedAtMs;
    if (durationMs > 0) {
      completedDurations.push(durationMs);
    }
  }

  if (completedDurations.length === 0) {
    return undefined;
  }

  const unfinishedItems = queue.items.filter((item) => {
    return item.status === "active" || item.status === "pending";
  });
  if (unfinishedItems.length === 0) {
    return undefined;
  }

  let totalCompletedDurationMs = 0;
  for (const durationMs of completedDurations) {
    totalCompletedDurationMs += durationMs;
  }

  const averageDurationMs = totalCompletedDurationMs / completedDurations.length;
  let etaMs = 0;
  for (const item of unfinishedItems) {
    if (item.status === "active" && item.startedAtMs !== undefined) {
      etaMs += Math.max(0, averageDurationMs - (nowMs - item.startedAtMs));
      continue;
    }

    etaMs += averageDurationMs;
  }

  return Math.round(etaMs);
};
import { DEFAULT_DOWNLOAD_ADMISSION_COST } from "@/features/import/downloadAdmissionWindow";
