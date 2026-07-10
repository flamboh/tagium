import { describe, expect, it } from "vite-plus/test";
import {
  createPlaylistDownloadQueue,
  derivePlaylistDownloadQueueSummary,
  markPlaylistDownloadActive,
  markPlaylistDownloadCanceled,
  markPlaylistDownloadCompleted,
  markPlaylistDownloadFailed,
  retryPlaylistDownloadItem,
} from "./playlistDownloadQueue";
import type { PlaylistDownloadQueueTrack } from "./playlistDownloadQueue";

const tracks = (count: number): PlaylistDownloadQueueTrack[] =>
  Array.from({ length: count }, (_value, index) => ({
    id: `track-${index + 1}`,
    title: `Track ${index + 1}`,
    sourceUrl: `https://soundcloud.com/artist/track-${index + 1}`,
  }));

describe("playlistDownloadQueue", () => {
  it("creates every playlist item pending immediately", () => {
    const queue = createPlaylistDownloadQueue(tracks(3));

    expect(queue.items.map((item) => item.status)).toEqual(["pending", "pending", "pending"]);
    expect(queue.items.map((item) => item.tunnelCost)).toEqual([2, 2, 2]);
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
