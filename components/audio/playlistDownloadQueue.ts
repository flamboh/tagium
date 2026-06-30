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

export interface PlaylistDownloadQueueBudgetReservation {
  itemId: string;
  tunnelCost: number;
  reservedAtMs: number;
}

export interface PlaylistDownloadQueueState {
  items: PlaylistDownloadQueueItem[];
  budgetReservations: PlaylistDownloadQueueBudgetReservation[];
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
  waitingForTunnelBudget: boolean;
  nextBudgetWaitMs?: number;
  etaMs?: number;
}

export type PlaylistDownloadQueueBudgetResult =
  | {
      status: "reserved";
      queue: PlaylistDownloadQueueState;
    }
  | {
      status: "waiting-for-tunnel-budget";
      queue: PlaylistDownloadQueueState;
      waitMs: number;
    };

export const PLAYLIST_DOWNLOAD_TUNNEL_BUDGET = 40;
export const PLAYLIST_DOWNLOAD_TUNNEL_BUDGET_WINDOW_MS = 60_000;
export const SOUND_CLOUD_TRACK_TUNNEL_COST = 2;

export const createPlaylistDownloadQueueItem = (
  track: PlaylistDownloadQueueTrack,
): PlaylistDownloadQueueItem => {
  let tunnelCost = SOUND_CLOUD_TRACK_TUNNEL_COST;
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
): PlaylistDownloadQueueState => ({
  items: tracks.map(createPlaylistDownloadQueueItem),
  budgetReservations: [],
});

export const getNextPlaylistDownloadBudgetWaitMs = (
  queue: PlaylistDownloadQueueState,
  tunnelCost: number,
  nowMs: number,
) => {
  if (tunnelCost > PLAYLIST_DOWNLOAD_TUNNEL_BUDGET) {
    throw new Error("playlist download item exceeds Cobalt tunnel budget.");
  }

  const reservations = getActiveBudgetReservations(queue, nowMs);
  let usedTunnelCount = 0;
  for (const reservation of reservations) {
    usedTunnelCount += reservation.tunnelCost;
  }

  if (usedTunnelCount + tunnelCost <= PLAYLIST_DOWNLOAD_TUNNEL_BUDGET) {
    return 0;
  }

  let releasedTunnelCount = 0;
  const sortedReservations = [...reservations].sort((left, right) => {
    return left.reservedAtMs - right.reservedAtMs;
  });

  for (const reservation of sortedReservations) {
    releasedTunnelCount += reservation.tunnelCost;
    if (usedTunnelCount - releasedTunnelCount + tunnelCost <= PLAYLIST_DOWNLOAD_TUNNEL_BUDGET) {
      const availableAtMs = reservation.reservedAtMs + PLAYLIST_DOWNLOAD_TUNNEL_BUDGET_WINDOW_MS;
      return Math.max(0, availableAtMs - nowMs);
    }
  }

  throw new Error("playlist download budget wait could not be calculated.");
};

export const reservePlaylistDownloadBudget = (
  queue: PlaylistDownloadQueueState,
  itemId: string,
  nowMs: number,
): PlaylistDownloadQueueBudgetResult => {
  const item = findPlaylistDownloadQueueItem(queue, itemId);
  if (item.status !== "pending") {
    throw new Error("playlist download budget can only be reserved for pending items.");
  }

  const budgetReservations = getActiveBudgetReservations(queue, nowMs);
  const waitMs = getNextPlaylistDownloadBudgetWaitMs(queue, item.tunnelCost, nowMs);
  const nextQueue = {
    ...queue,
    budgetReservations,
  };

  if (waitMs > 0) {
    return {
      status: "waiting-for-tunnel-budget",
      queue: nextQueue,
      waitMs,
    };
  }

  return {
    status: "reserved",
    queue: {
      ...nextQueue,
      budgetReservations: [
        ...budgetReservations,
        {
          itemId,
          tunnelCost: item.tunnelCost,
          reservedAtMs: nowMs,
        },
      ],
    },
  };
};

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
  let nextBudgetWaitMs: number | undefined;

  const firstPendingItem = pendingItems[0];
  if (firstPendingItem) {
    const waitMs = getNextPlaylistDownloadBudgetWaitMs(queue, firstPendingItem.tunnelCost, nowMs);
    if (waitMs > 0) {
      nextBudgetWaitMs = waitMs;
    }
  }

  return {
    label: `Downloading ${completedCount}/${queue.items.length}`,
    totalCount: queue.items.length,
    completedCount,
    activeCount: activeItems.length,
    pendingCount: pendingItems.length,
    failedCount,
    canceledCount,
    activeTitles: activeItems.map((item) => item.title),
    waitingForTunnelBudget: nextBudgetWaitMs !== undefined,
    nextBudgetWaitMs,
    etaMs: estimatePlaylistDownloadQueueEtaMs(queue, nowMs),
  };
};

const getActiveBudgetReservations = (queue: PlaylistDownloadQueueState, nowMs: number) =>
  queue.budgetReservations.filter((reservation) => {
    return reservation.reservedAtMs + PLAYLIST_DOWNLOAD_TUNNEL_BUDGET_WINDOW_MS > nowMs;
  });

const findPlaylistDownloadQueueItem = (queue: PlaylistDownloadQueueState, itemId: string) => {
  const item = queue.items.find((entry) => entry.id === itemId);
  if (!item) {
    throw new Error("playlist download item not found.");
  }

  return item;
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
