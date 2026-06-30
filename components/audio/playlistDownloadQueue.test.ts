import { describe, expect, it } from "vite-plus/test";
import {
  createPlaylistDownloadQueue,
  derivePlaylistDownloadQueueSummary,
  getNextPlaylistDownloadBudgetWaitMs,
  markPlaylistDownloadActive,
  markPlaylistDownloadCanceled,
  markPlaylistDownloadCompleted,
  markPlaylistDownloadFailed,
  reservePlaylistDownloadBudget,
  retryPlaylistDownloadItem,
} from "./playlistDownloadQueue";
import type {
  PlaylistDownloadQueueState,
  PlaylistDownloadQueueTrack,
} from "./playlistDownloadQueue";

const tracks = (count: number): PlaylistDownloadQueueTrack[] =>
  Array.from({ length: count }, (_value, index) => ({
    id: `track-${index + 1}`,
    title: `Track ${index + 1}`,
    sourceUrl: `https://soundcloud.com/artist/track-${index + 1}`,
  }));

const reserve = (
  queue: PlaylistDownloadQueueState,
  itemId: string,
  nowMs: number,
): PlaylistDownloadQueueState => {
  const result = reservePlaylistDownloadBudget(queue, itemId, nowMs);
  expect(result.status).toBe("reserved");
  return result.queue;
};

describe("playlistDownloadQueue", () => {
  it("creates every playlist item pending immediately", () => {
    const queue = createPlaylistDownloadQueue(tracks(3));

    expect(queue.items.map((item) => item.status)).toEqual(["pending", "pending", "pending"]);
    expect(queue.items.map((item) => item.tunnelCost)).toEqual([2, 2, 2]);
  });

  it("fits 20 two-tunnel SoundCloud tracks and makes the 21st wait", () => {
    let queue = createPlaylistDownloadQueue(tracks(21));

    for (const item of queue.items.slice(0, 20)) {
      queue = reserve(queue, item.id, 0);
    }

    const wait = reservePlaylistDownloadBudget(queue, "track-21", 0);

    expect(queue.budgetReservations).toHaveLength(20);
    expect(getNextPlaylistDownloadBudgetWaitMs(queue, 2, 0)).toBe(60_000);
    expect(wait).toEqual({
      status: "waiting-for-tunnel-budget",
      queue,
      waitMs: 60_000,
    });
  });

  it("keeps the 21st track pending when active tracks hold the Cobalt budget", () => {
    let queue = createPlaylistDownloadQueue(tracks(21));

    for (const item of queue.items.slice(0, 20)) {
      queue = reserve(queue, item.id, 0);
      queue = markPlaylistDownloadActive(queue, item.id, 0);
    }

    const wait = reservePlaylistDownloadBudget(queue, "track-21", 0);
    const summary = derivePlaylistDownloadQueueSummary(wait.queue, 0);

    expect(wait.status).toBe("waiting-for-tunnel-budget");
    expect(wait.queue.items[20].status).toBe("pending");
    expect(summary.activeCount).toBe(20);
    expect(summary.pendingCount).toBe(1);
    expect(summary.waitingForTunnelBudget).toBe(true);
    expect(getNextPlaylistDownloadBudgetWaitMs(wait.queue, 2, 60_000)).toBe(0);
  });

  it("keeps tunnel-budget waits out of failed state", () => {
    let queue = createPlaylistDownloadQueue(tracks(21));

    for (const item of queue.items.slice(0, 20)) {
      queue = reserve(queue, item.id, 0);
    }

    const wait = reservePlaylistDownloadBudget(queue, "track-21", 0);
    const summary = derivePlaylistDownloadQueueSummary(wait.queue, 0);

    expect(wait.status).toBe("waiting-for-tunnel-budget");
    expect(wait.queue.items[20].status).toBe("pending");
    expect(summary.failedCount).toBe(0);
    expect(summary.waitingForTunnelBudget).toBe(true);
    expect(summary.nextBudgetWaitMs).toBe(60_000);
  });

  it("derives progress counts and active titles", () => {
    let queue = createPlaylistDownloadQueue(tracks(3));
    queue = markPlaylistDownloadActive(queue, "track-1", 0);
    queue = markPlaylistDownloadActive(queue, "track-2", 1_000);
    queue = markPlaylistDownloadCompleted(queue, "track-1", 10_000);

    const summary = derivePlaylistDownloadQueueSummary(queue, 12_000);

    expect(summary.label).toBe("Downloading 1/3");
    expect(summary.completedCount).toBe(1);
    expect(summary.activeCount).toBe(1);
    expect(summary.pendingCount).toBe(1);
    expect(summary.activeTitles).toEqual(["Track 2"]);
  });

  it("retries failed and canceled items as pending", () => {
    let queue = createPlaylistDownloadQueue(tracks(2));
    queue = markPlaylistDownloadActive(queue, "track-1", 0);
    queue = markPlaylistDownloadFailed(queue, "track-1", "network failed", 1_000);
    queue = markPlaylistDownloadActive(queue, "track-2", 0);
    queue = markPlaylistDownloadCanceled(queue, "track-2", 1_000);

    queue = retryPlaylistDownloadItem(queue, "track-1");
    queue = retryPlaylistDownloadItem(queue, "track-2");

    expect(queue.items[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      error: undefined,
      startedAtMs: undefined,
      failedAtMs: undefined,
    });
    expect(queue.items[1]).toMatchObject({
      status: "pending",
      attempts: 1,
      canceledAtMs: undefined,
    });
  });

  it("only derives ETA when completed durations exist", () => {
    let queue = createPlaylistDownloadQueue(tracks(3));
    queue = markPlaylistDownloadActive(queue, "track-1", 0);

    expect(derivePlaylistDownloadQueueSummary(queue, 5_000).etaMs).toBeUndefined();

    queue = markPlaylistDownloadCompleted(queue, "track-1", 10_000);
    queue = markPlaylistDownloadActive(queue, "track-2", 10_000);

    expect(derivePlaylistDownloadQueueSummary(queue, 15_000).etaMs).toBe(15_000);
  });
});
