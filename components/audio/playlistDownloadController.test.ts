import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import {
  createPlaylistDownloadController,
  type PlaylistDownloadControllerAction,
  type PlaylistDownloadControllerSnapshot,
} from "./playlistDownloadController";
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

const flushEffects = async () => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
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
          const hydration = hydrations.get(track.fileId);
          return hydration?.promise ?? Promise.resolve();
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
  it("starts at concurrency 3 and publishes active tracks immediately", async () => {
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

  it("waits on the 21st SoundCloud track without failing it and wakes on budget", async () => {
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
    expect(harness.downloads.has("track-21")).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    await flushEffects();

    expect(harness.downloads.has("track-21")).toBe(true);
    expect(harness.snapshots.at(-1)).toMatchObject({
      waitingForTunnelBudget: false,
      active: [{ fileId: "track-21" }],
    });
  });

  it("cancels pending and active tracks, aborts active work, then finishes when idle", async () => {
    const harness = createControllerHarness();

    harness.controller.enqueue(tracks(4));
    await flushEffects();
    harness.controller.cancel();
    await flushEffects();

    expect(harness.downloadSignals.get("track-1")?.aborted).toBe(true);
    expect(harness.downloadSignals.get("track-2")?.aborted).toBe(true);
    expect(harness.downloadSignals.get("track-3")?.aborted).toBe(true);
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
    expect(harness.lifecycle).toEqual(
      expect.arrayContaining(
        tracks(4).map((track) => ({
          track,
          outcome: "canceled",
        })),
      ),
    );
    expect(harness.actions).toEqual([
      {
        type: "cancel_requested",
        snapshot: expect.objectContaining({
          total: 4,
          completed: 0,
          active: [
            expect.objectContaining({ fileId: "track-1" }),
            expect.objectContaining({ fileId: "track-2" }),
            expect.objectContaining({ fileId: "track-3" }),
          ],
          pending: 1,
        }),
      },
    ]);
  });

  it("retries failed, canceled, and completed-with-file-error tracks without duplicates", async () => {
    const harness = createControllerHarness();
    harness.controller.enqueue(tracks(3));
    await flushEffects();

    harness.downloads.get("track-1")?.reject(new Error("network failed"));
    harness.downloads.get("track-2")?.reject(new DOMException("aborted", "AbortError"));
    harness.downloads.get("track-3")?.resolve(audioFile("track-3.mp3"));
    await flushEffects();

    harness.fileErrorTrackIds.add("track-3");
    harness.controller.retry(tracks(3));
    await flushEffects();

    expect(harness.queued.at(-1)).toEqual(["track-1", "track-2", "track-3"]);
    expect(harness.snapshots.at(-1)).toMatchObject({
      total: 3,
      completed: 0,
      failed: 0,
      pending: 0,
    });
    expect(harness.controller.getSnapshot()?.trackIds).toEqual(["track-1", "track-2", "track-3"]);
    expect(harness.actions).toEqual([
      {
        type: "retry_started",
        tracks: tracks(3),
        previousSnapshot: expect.objectContaining({
          total: 3,
          completed: 1,
          failed: 1,
          canceledCount: 1,
          done: true,
        }),
      },
    ]);
  });

  it("does not let stale completions mutate a newer run", async () => {
    const harness = createControllerHarness();
    harness.controller.enqueue([tracks(1)[0]]);
    await flushEffects();
    harness.controller.cancel();
    await flushEffects();

    harness.controller.enqueue([tracks(2)[1]]);
    await flushEffects();
    harness.downloads.get("track-1")?.resolve(audioFile("stale.mp3"));
    await flushEffects();

    expect(harness.controller.getSnapshot()).toMatchObject({
      trackIds: ["track-2"],
      completed: 0,
      active: [{ fileId: "track-2" }],
    });
  });

  it("does not let stale pending hydration complete an old run after cancel and retry", async () => {
    const harness = createControllerHarness();
    harness.hydrations.set("track-1", deferred<void>());

    harness.controller.enqueue([tracks(1)[0]]);
    await flushEffects();
    harness.downloads.get("track-1")?.resolve(audioFile("track-1.mp3"));
    await flushEffects();

    expect(harness.hydrated).toEqual(["track-1"]);
    harness.controller.cancel();
    await flushEffects();
    expect(harness.hydrationSignals.get("track-1")?.aborted).toBe(true);

    harness.controller.enqueue([tracks(2)[1]]);
    await flushEffects();
    harness.hydrations.get("track-1")?.resolve();
    await flushEffects();

    expect(harness.controller.getSnapshot()).toMatchObject({
      trackIds: ["track-2"],
      completed: 0,
      active: [{ fileId: "track-2" }],
    });
  });

  it("treats hydration error state as completed when hydrate resolves", async () => {
    const harness = createControllerHarness();
    harness.controller.enqueue([tracks(1)[0]]);
    await flushEffects();

    harness.downloads.get("track-1")?.resolve(audioFile("track-1.mp3"));
    await flushEffects();

    expect(harness.hydrated).toEqual(["track-1"]);
    expect(harness.failed).toEqual([]);
    expect(harness.controller.getSnapshot()).toMatchObject({
      completed: 1,
      done: true,
    });
  });

  it("reports completion only after download and hydration both succeed", async () => {
    const harness = createControllerHarness();
    harness.hydrations.set("track-1", deferred<void>());
    harness.controller.enqueue([tracks(1)[0]]);
    await flushEffects();

    harness.downloads.get("track-1")?.resolve(audioFile("track-1.mp3"));
    await flushEffects();
    expect(harness.lifecycle).toEqual([]);

    harness.hydrations.get("track-1")?.resolve();
    await flushEffects();

    expect(harness.lifecycle).toEqual([
      {
        track: tracks(1)[0],
        outcome: "completed",
      },
    ]);
  });

  it("settles a track removed before work starts as canceled", async () => {
    const harness = createControllerHarness({ hasTrack: () => false });

    harness.controller.enqueue([tracks(1)[0]]);
    await flushEffects();

    expect(harness.downloads.size).toBe(0);
    expect(harness.hydrated).toEqual([]);
    expect(harness.lifecycle).toEqual([{ track: tracks(1)[0], outcome: "canceled" }]);
    expect(harness.canceled).toEqual([["track-1"]]);
    expect(harness.controller.getSnapshot()).toMatchObject({
      completed: 0,
      canceledCount: 1,
      done: true,
    });
  });
});
