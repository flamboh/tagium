import { describe, expect, it } from "vite-plus/test";
import {
  cancelActivePlaylistDownloadTracks,
  cancelPendingPlaylistDownloadTracks,
  createPlaylistDownloadQueueRun,
  derivePlaylistDownloadQueueState,
  enqueuePlaylistDownloadQueueTracks,
  markPlaylistDownloadTrackActive,
  markPlaylistDownloadTrackCanceled,
  markPlaylistDownloadTrackCompleted,
  markPlaylistDownloadTrackFailed,
  removeActivePlaylistDownloadTrack,
  reserveNextPlaylistDownloadTrack,
} from "./playlistDownloadQueueRuntime";
import type { PlaylistDownloadRuntimeTrack } from "./playlistDownloadQueueRuntime";

type Track = PlaylistDownloadRuntimeTrack & {
  sourceUrl: string;
};

const tracks = (count: number): Track[] =>
  Array.from({ length: count }, (_value, index) => ({
    fileId: `track-${index + 1}`,
    title: `Track ${index + 1}`,
    sourceUrl: `https://soundcloud.com/artist/track-${index + 1}`,
  }));

const createRun = (count: number) =>
  createPlaylistDownloadQueueRun(1, tracks(count), 0, (track) => ({
    id: track.fileId,
    title: track.title,
    sourceUrl: track.sourceUrl,
  }));

const reserve = (run: ReturnType<typeof createRun>, nowMs: number) => {
  const result = reserveNextPlaylistDownloadTrack(run, nowMs);
  expect(result.status).toBe("reserved");
  if (result.status !== "reserved") {
    throw new Error("expected reserved playlist track.");
  }
  return result.track;
};

describe("playlistDownloadQueueRuntime", () => {
  it("waits on the 21st track before marking it active", () => {
    const run = createRun(21);

    for (let index = 0; index < 20; index += 1) {
      reserve(run, 0);
    }

    const result = reserveNextPlaylistDownloadTrack(run, 0);
    const state = derivePlaylistDownloadQueueState(run, 0);

    expect(result).toEqual({
      status: "waiting-for-tunnel-budget",
      waitMs: 60_000,
    });
    expect(run.active).toEqual([]);
    expect(run.pending.map((track) => track.fileId)).toEqual(["track-21"]);
    expect(run.model.items[20].status).toBe("pending");
    expect(state.waitingForTunnelBudget).toBe(true);
  });

  it("exposes the budget wake result when tunnel capacity opens later", () => {
    const run = createRun(21);

    for (let index = 0; index < 20; index += 1) {
      reserve(run, 0);
    }

    expect(reserveNextPlaylistDownloadTrack(run, 59_999)).toEqual({
      status: "waiting-for-tunnel-budget",
      waitMs: 1,
    });
    expect(reserveNextPlaylistDownloadTrack(run, 60_000)).toMatchObject({
      status: "reserved",
      track: { fileId: "track-21" },
    });
  });

  it("retries failed, canceled, and completed file-error items without duplicating queue items", () => {
    const retryTracks = tracks(3);
    const run = createRun(3);
    const firstTrack = reserve(run, 0);
    markPlaylistDownloadTrackActive(run, firstTrack, 0);
    markPlaylistDownloadTrackFailed(run, firstTrack.fileId, "network failed", 1_000);
    removeActivePlaylistDownloadTrack(run, firstTrack.fileId);

    const secondTrack = reserve(run, 0);
    markPlaylistDownloadTrackActive(run, secondTrack, 0);
    markPlaylistDownloadTrackCanceled(run, secondTrack.fileId, 1_000);
    removeActivePlaylistDownloadTrack(run, secondTrack.fileId);

    const thirdTrack = reserve(run, 0);
    markPlaylistDownloadTrackActive(run, thirdTrack, 0);
    markPlaylistDownloadTrackCompleted(run, thirdTrack.fileId, 1_000);
    removeActivePlaylistDownloadTrack(run, thirdTrack.fileId);

    const queuedTracks = enqueuePlaylistDownloadQueueTracks(
      run,
      retryTracks,
      2_000,
      new Set(["track-3"]),
      (track) => ({
        id: track.fileId,
        title: track.title,
        sourceUrl: track.sourceUrl,
      }),
    );

    expect(queuedTracks.map((track) => track.fileId)).toEqual(["track-1", "track-2", "track-3"]);
    expect(run.pending.map((track) => track.fileId)).toEqual(["track-1", "track-2", "track-3"]);
    expect(run.total).toBe(3);
    expect(run.completed).toBe(0);
    expect(run.failed).toBe(0);
    expect(run.model.items).toHaveLength(3);
    expect(run.model.items.map((item) => item.status)).toEqual(["pending", "pending", "pending"]);
    expect(derivePlaylistDownloadQueueState(run, 2_000)).toMatchObject({
      total: 3,
      completed: 0,
      pending: 3,
    });
  });

  it("marks pending and active queue items canceled", () => {
    const run = createRun(3);
    const activeTrack = reserve(run, 0);
    markPlaylistDownloadTrackActive(run, activeTrack, 0);

    const pendingCanceledTrackIds = cancelPendingPlaylistDownloadTracks(run, 1_000);
    const activeCanceledTrackIds = cancelActivePlaylistDownloadTracks(run, 1_000);

    expect(pendingCanceledTrackIds).toEqual(["track-2", "track-3"]);
    expect(activeCanceledTrackIds).toEqual(["track-1"]);
    expect(run.pending).toEqual([]);
    expect(run.active.map((track) => track.fileId)).toEqual(["track-1"]);
    expect(run.model.items.map((item) => item.status)).toEqual([
      "canceled",
      "canceled",
      "canceled",
    ]);
    expect(derivePlaylistDownloadQueueState(run, 1_000).canceledCount).toBe(3);
  });
});
