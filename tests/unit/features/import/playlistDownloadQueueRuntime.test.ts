import { describe, expect, it } from "vite-plus/test";
import {
  cancelActivePlaylistDownloadTracks,
  cancelPendingPlaylistDownloadTracks,
  createPlaylistDownloadQueueRun,
  derivePlaylistDownloadQueueState,
  markPlaylistDownloadTrackActive,
  markPlaylistDownloadTrackCompleted,
  removeActivePlaylistDownloadTrack,
  removePlaylistDownloadTracks,
  reserveNextPlaylistDownloadTrack,
} from "@/features/import/playlistDownloadQueueRuntime";
import type { PlaylistDownloadRuntimeTrack } from "@/features/import/playlistDownloadQueueRuntime";
import {
  createDownloadAdmissionWindow,
  type DownloadAdmissionWindow,
} from "@/shared/cobalt/downloadAdmissionWindow";

type Track = PlaylistDownloadRuntimeTrack & {
  sourceUrl: string;
};

const tracks = (count: number): Track[] =>
  Array.from({ length: count }, (_value, index) => ({
    fileId: `track-${index + 1}`,
    title: `Track ${index + 1}`,
    sourceUrl: `https://soundcloud.com/artist/track-${index + 1}`,
  }));

const admissionByRun = new WeakMap<object, DownloadAdmissionWindow>();

const createRun = (count: number) => {
  const run = createPlaylistDownloadQueueRun(1, tracks(count), 0, (track) => ({
    id: track.fileId,
    title: track.title,
    sourceUrl: track.sourceUrl,
  }));
  admissionByRun.set(run, createDownloadAdmissionWindow());
  return run;
};

const getAdmission = (run: ReturnType<typeof createRun>) => {
  const admission = admissionByRun.get(run);
  if (!admission) throw new Error("download admission not found for test run.");
  return admission;
};

const reserve = (run: ReturnType<typeof createRun>, nowMs: number) => {
  const result = reserveNextPlaylistDownloadTrack(run, getAdmission(run), nowMs);
  expect(result.status).toBe("reserved");
  if (result.status !== "reserved") {
    throw new Error("expected reserved playlist track.");
  }
  return result.track;
};

describe("playlistDownloadQueueRuntime", () => {
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

  it("removes deleted tracks from totals while retaining active work until it settles", () => {
    const run = createRun(5);
    const firstTrack = reserve(run, 0);
    const secondTrack = reserve(run, 0);
    markPlaylistDownloadTrackActive(run, firstTrack, 0);
    markPlaylistDownloadTrackActive(run, secondTrack, 0);
    markPlaylistDownloadTrackCompleted(run, firstTrack.fileId, 1_000);
    removeActivePlaylistDownloadTrack(run, firstTrack.fileId);

    const result = removePlaylistDownloadTracks(run, ["track-1", "track-2", "track-5"]);

    expect(result).toEqual({
      removedTrackIds: ["track-1", "track-2", "track-5"],
      pendingTracks: [expect.objectContaining({ fileId: "track-5" })],
      activeTrackIds: ["track-2"],
    });
    expect(run.active.map((track) => track.fileId)).toEqual(["track-2"]);
    expect(run.pending.map((track) => track.fileId)).toEqual(["track-3", "track-4"]);
    expect(derivePlaylistDownloadQueueState(run, 1_000)).toMatchObject({
      trackIds: ["track-3", "track-4"],
      total: 2,
      completed: 0,
      active: [],
      pending: 2,
    });
  });
});
