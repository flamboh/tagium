import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import {
  createPlaylistDownloadController,
  type PlaylistDownloadControllerAction,
  type PlaylistDownloadControllerSnapshot,
} from "@/features/import/playlistDownloadController";
import type { PlaylistDownloadRuntimeTrack } from "@/features/import/playlistDownloadQueueRuntime";

type Track = PlaylistDownloadRuntimeTrack & { sourceUrl: string };

const tracks = (count: number): Track[] =>
  Array.from({ length: count }, (_value, index) => ({
    fileId: `track-${index + 1}`,
    title: `Track ${index + 1}`,
    sourceUrl: `https://soundcloud.com/artist/track-${index + 1}`,
  }));

const flushEffects = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const audioFile = (name = "track.mp3") => new File(["audio"], name, { type: "audio/mpeg" });

const createControllerHarness = (
  options: { now?: () => number; hasTrack?: (id: string) => boolean } = {},
) => {
  const snapshots: PlaylistDownloadControllerSnapshot[] = [];
  const queued: string[][] = [];
  const canceled: string[][] = [];
  const failed: Array<{ trackId: string; error: unknown }> = [];
  const hydrated: string[] = [];
  const downloadStarts: string[] = [];
  const downloads = new Map<string, ReturnType<typeof deferred<File>>>();
  const hydrations = new Map<string, ReturnType<typeof deferred<void>>>();
  const downloadSignals = new Map<string, AbortSignal>();
  const hydrationSignals = new Map<string, AbortSignal>();
  const lifecycle: Array<{
    track: Track;
    outcome: "completed" | "failed" | "canceled";
    error?: unknown;
  }> = [];
  const actions: PlaylistDownloadControllerAction<Track>[] = [];
  const fileErrorTrackIds = new Set<string>();
  const now = options.now ?? (() => Date.now());

  const controller = createPlaylistDownloadController<Track>({
    now,
    createModelTrack: (track) => ({
      id: track.fileId,
      title: track.title,
      sourceUrl: track.sourceUrl,
    }),
    downloadTrack: (track) =>
      Effect.tryPromise({
        try: (signal) => {
          downloadStarts.push(track.fileId);
          downloadSignals.set(track.fileId, signal);
          const download = deferred<File>();
          downloads.set(track.fileId, download);
          return download.promise;
        },
        catch: (error) => error,
      }),
    hydrateTrack: (track) =>
      Effect.tryPromise({
        try: (signal) => {
          hydrationSignals.set(track.fileId, signal);
          hydrated.push(track.fileId);
          return hydrations.get(track.fileId)?.promise ?? Promise.resolve();
        },
        catch: (error) => error,
      }),
    hasTrack: options.hasTrack ?? (() => true),
    getFileErrorTrackIds: () => new Set(fileErrorTrackIds),
    markQueued: (nextTracks) => queued.push(nextTracks.map((track) => track.fileId)),
    markCanceled: (trackIds) => canceled.push(trackIds),
    markFailed: (trackId, error) => failed.push({ trackId, error }),
    onTrackSettled: (event) => lifecycle.push(event),
    onAction: (event) => actions.push(event),
    emitSnapshot: (snapshot) => snapshots.push(snapshot),
  });

  return {
    controller,
    snapshots,
    queued,
    canceled,
    failed,
    hydrated,
    downloadStarts,
    downloads,
    hydrations,
    downloadSignals,
    hydrationSignals,
    lifecycle,
    actions,
    fileErrorTrackIds,
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("playlistDownloadController", () => {
  it("starts three downloads and publishes active tracks immediately", async () => {
    const harness = createControllerHarness();
    harness.controller.enqueue(tracks(5));
    await flushEffects();

    expect(harness.queued).toEqual([["track-1", "track-2", "track-3", "track-4", "track-5"]]);
    expect(harness.downloads.size).toBe(3);
    expect(harness.snapshots.at(-1)).toMatchObject({
      active: [{ fileId: "track-1" }, { fileId: "track-2" }, { fileId: "track-3" }],
      pending: 2,
      completed: 0,
    });
  });

  it("waits on the 21st SoundCloud track and wakes when budget opens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const harness = createControllerHarness();
    harness.controller.enqueue(tracks(21));
    await flushEffects();

    for (let index = 1; index <= 20; index += 1) {
      harness.downloads.get(`track-${index}`)?.resolve(audioFile(`track-${index}.mp3`));
      await flushEffects();
    }
    expect(harness.failed).toEqual([]);
    expect(harness.snapshots.at(-1)).toMatchObject({
      completed: 20,
      pending: 1,
      waitingForTunnelBudget: true,
      done: false,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await flushEffects();
    expect(harness.downloads.has("track-21")).toBe(true);
    expect(harness.snapshots.at(-1)).toMatchObject({
      waitingForTunnelBudget: false,
      active: [{ fileId: "track-21" }],
    });
  });

  it("cancels active and pending tracks, aborts work, and finishes when idle", async () => {
    const harness = createControllerHarness();
    harness.controller.enqueue(tracks(4));
    await flushEffects();
    harness.controller.cancel();
    await flushEffects();

    expect(harness.downloadSignals.get("track-1")?.aborted).toBe(true);
    expect(harness.canceled.flat()).toEqual(
      expect.arrayContaining(["track-1", "track-2", "track-3", "track-4"]),
    );
    for (let index = 1; index <= 3; index += 1) {
      harness.downloads.get(`track-${index}`)?.reject(new DOMException("aborted", "AbortError"));
    }
    await flushEffects();

    expect(harness.failed).toEqual([]);
    expect(harness.snapshots.at(-1)).toMatchObject({
      canceled: true,
      done: true,
      canceledCount: 4,
      active: [],
    });
  });

  it("removes deleted active and pending tracks from the current run", async () => {
    const harness = createControllerHarness();
    harness.controller.enqueue(tracks(5));
    await flushEffects();
    harness.controller.remove(["track-2", "track-5"]);
    await flushEffects();

    expect(harness.downloadSignals.get("track-2")?.aborted).toBe(true);
    expect(harness.downloadStarts).not.toContain("track-5");
    expect(harness.controller.getSnapshot()).toMatchObject({
      trackIds: ["track-1", "track-3", "track-4"],
      total: 3,
      active: [{ fileId: "track-1" }, { fileId: "track-3" }, { fileId: "track-4" }],
      pending: 0,
    });
  });

  it("ignores a stale completion after a newer run starts", async () => {
    const harness = createControllerHarness();
    harness.controller.enqueue([tracks(1)[0]!]);
    await flushEffects();
    harness.controller.cancel();
    await flushEffects();
    harness.controller.enqueue([tracks(2)[1]!]);
    await flushEffects();
    harness.downloads.get("track-1")?.resolve(audioFile("stale.mp3"));
    await flushEffects();

    expect(harness.controller.getSnapshot()).toMatchObject({
      trackIds: ["track-2"],
      completed: 0,
      active: [{ fileId: "track-2" }],
    });
  });

  it("does not let cancellation settle an immediate retry with the same id", async () => {
    const harness = createControllerHarness();
    harness.controller.enqueue([tracks(1)[0]!]);
    await flushEffects();
    harness.controller.cancel();
    harness.controller.retry([tracks(1)[0]!]);
    await flushEffects();

    expect(harness.lifecycle).toEqual([{ track: tracks(1)[0], outcome: "canceled" }]);
    harness.downloads.get("track-1")?.resolve(audioFile("retry.mp3"));
    await flushEffects();
    expect(harness.actions.at(-1)).toEqual(
      expect.objectContaining({
        type: "retry_finished",
        completedCount: 1,
        failedCount: 0,
        canceledCount: 0,
        outcome: "completed",
      }),
    );
  });

  it("keeps retry generations separate when a retry is removed and retried", async () => {
    const harness = createControllerHarness();
    harness.controller.enqueue([tracks(1)[0]!]);
    await flushEffects();
    harness.downloads.get("track-1")?.reject(new Error("initial failure"));
    await flushEffects();

    harness.controller.retry([tracks(1)[0]!]);
    await flushEffects();
    harness.controller.remove(["track-1"]);
    harness.controller.retry([tracks(1)[0]!]);
    await flushEffects();

    expect(harness.actions).toEqual([
      expect.objectContaining({ type: "retry_started", retryAttemptId: 1 }),
      expect.objectContaining({ type: "retry_finished", retryAttemptId: 1, canceledCount: 1 }),
      expect.objectContaining({ type: "retry_started", retryAttemptId: 2 }),
    ]);
    expect(harness.controller.getSnapshot()).toMatchObject({
      active: [{ fileId: "track-1" }],
      done: false,
    });

    harness.downloads.get("track-1")?.resolve(audioFile("second-retry.mp3"));
    await flushEffects();
    expect(harness.actions.at(-1)).toEqual(
      expect.objectContaining({
        type: "retry_finished",
        retryAttemptId: 2,
        completedCount: 1,
        canceledCount: 0,
        outcome: "completed",
      }),
    );
  });

  it("ignores stale hydration after cancel and a new run", async () => {
    const harness = createControllerHarness();
    harness.hydrations.set("track-1", deferred<void>());
    harness.controller.enqueue([tracks(1)[0]!]);
    await flushEffects();
    harness.downloads.get("track-1")?.resolve(audioFile("track-1.mp3"));
    await flushEffects();
    expect(harness.hydrated).toEqual(["track-1"]);

    harness.controller.cancel();
    await flushEffects();
    expect(harness.hydrationSignals.get("track-1")?.aborted).toBe(true);
    harness.controller.enqueue([tracks(2)[1]!]);
    await flushEffects();
    harness.hydrations.get("track-1")?.resolve();
    await flushEffects();

    expect(harness.controller.getSnapshot()).toMatchObject({
      trackIds: ["track-2"],
      completed: 0,
      active: [{ fileId: "track-2" }],
    });
  });

  it("reports completion only after download and hydration both succeed", async () => {
    const harness = createControllerHarness();
    harness.hydrations.set("track-1", deferred<void>());
    harness.controller.enqueue([tracks(1)[0]!]);
    await flushEffects();
    harness.downloads.get("track-1")?.resolve(audioFile("track-1.mp3"));
    await flushEffects();
    expect(harness.lifecycle).toEqual([]);

    harness.hydrations.get("track-1")?.resolve();
    await flushEffects();
    expect(harness.lifecycle).toEqual([{ track: tracks(1)[0], outcome: "completed" }]);
  });

  it("reports typed failure stages and one terminal retry outcome", async () => {
    const harness = createControllerHarness();
    harness.controller.enqueue(tracks(3));
    await flushEffects();
    for (let index = 1; index <= 3; index += 1) {
      harness.downloads.get(`track-${index}`)?.reject(new Error("initial failure"));
    }
    await flushEffects();

    harness.hydrations.set("track-2", deferred<void>());
    harness.controller.retry(tracks(3));
    await flushEffects();
    harness.downloads.get("track-1")?.reject(new Error("error.api.fetch.fail private-id"));
    harness.downloads.get("track-2")?.resolve(audioFile("track-2.mp3"));
    harness.downloads.get("track-3")?.resolve(audioFile("track-3.mp3"));
    await flushEffects();
    harness.hydrations.get("track-2")?.reject(new Error("private parse failure"));
    await flushEffects();

    expect(harness.lifecycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ track: tracks(3)[0], outcome: "failed", failureStage: "plan" }),
        expect.objectContaining({
          track: tracks(3)[1],
          outcome: "failed",
          failureStage: "hydration",
        }),
        { track: tracks(3)[2], outcome: "completed" },
      ]),
    );
    expect(harness.actions.at(-1)).toEqual(
      expect.objectContaining({
        type: "retry_finished",
        retryCount: 3,
        completedCount: 1,
        failedCount: 2,
        canceledCount: 0,
        outcome: "partial",
      }),
    );
  });

  it("registers accepted retry tracks before fast cancellation settles", async () => {
    const harness = createControllerHarness({ hasTrack: () => false });
    harness.controller.enqueue([tracks(1)[0]!]);
    await flushEffects();
    harness.controller.retry([tracks(1)[0]!, tracks(2)[1]!]);
    await flushEffects();

    expect(harness.actions).toEqual([
      expect.objectContaining({ type: "retry_started", retryAttemptId: 1 }),
      expect.objectContaining({
        type: "retry_finished",
        retryAttemptId: 1,
        retryCount: 2,
        completedCount: 0,
        failedCount: 0,
        canceledCount: 2,
        outcome: "canceled",
      }),
    ]);
  });
});
