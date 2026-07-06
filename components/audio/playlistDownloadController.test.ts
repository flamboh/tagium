import { describe, expect, it } from "vite-plus/test";
import { createPlaylistDownloadController } from "./playlistDownloadController";
import type { PlaylistDownloadControllerDeps } from "./playlistDownloadController";
import type { QueuedDownloadTrack } from "./downloadTrack";
import type { TagiumFile } from "./types";

const flushPromises = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const track = (id: string): QueuedDownloadTrack => ({
  fileId: id,
  title: `Track ${id}`,
  downloadRequest: {
    sourceUrl: `https://soundcloud.com/artist/${id}`,
    audioBitrate: "128",
  },
});

const file = (id: string, overrides: Partial<TagiumFile> = {}): TagiumFile =>
  ({
    id,
    filename: `${id}.mp3`,
    status: "pending",
    downloadStatus: "downloading",
    metadata: { title: `Track ${id}` },
    downloadRequest: track(id).downloadRequest,
    ...overrides,
  }) as TagiumFile;

const audioFile = (name = "download.mp3") => new File(["audio"], name, { type: "audio/mpeg" });

const createHarness = (overrides: Partial<PlaylistDownloadControllerDeps> = {}) => {
  let now = 0;
  let files = [file("1"), file("2"), file("3"), file("4"), file("5")];
  let nextTimerId = 0;
  const timers = new Map<number, () => void>();
  const snapshots: Array<
    ReturnType<ReturnType<typeof createPlaylistDownloadController>["getSnapshot"]>
  > = [];
  const queued: QueuedDownloadTrack[][] = [];
  const canceled: string[][] = [];
  const errors: Array<{ fileId: string; error: unknown }> = [];
  const downloads: Array<{
    request: QueuedDownloadTrack["downloadRequest"] & { signal: AbortSignal };
  }> = [];
  const hydrations: Array<{ fileId: string; downloadedFile: File; signal: AbortSignal }> = [];

  const deps: PlaylistDownloadControllerDeps = {
    concurrency: 2,
    now: () => now,
    setTimeout: (callback) => {
      nextTimerId += 1;
      timers.set(nextTimerId, callback);
      return nextTimerId;
    },
    clearTimeout: (timeout) => {
      timers.delete(timeout as number);
    },
    downloadAudio: async (request) => {
      downloads.push({ request });
      return audioFile();
    },
    hydrateDownloadedTrack: async (input) => {
      hydrations.push(input);
    },
    getFiles: () => files,
    markDownloadsQueued: (tracks) => {
      queued.push(tracks);
      const trackIds = new Set(tracks.map((queuedTrack) => queuedTrack.fileId));
      files = files.map((entry) =>
        trackIds.has(entry.id)
          ? { ...entry, status: "pending", downloadStatus: "downloading", downloadError: undefined }
          : entry,
      );
    },
    markDownloadsCanceled: (trackIds) => {
      canceled.push(trackIds);
      const trackIdSet = new Set(trackIds);
      files = files.map((entry) =>
        trackIdSet.has(entry.id) && entry.downloadStatus === "downloading"
          ? { ...entry, downloadStatus: "canceled", downloadError: undefined }
          : entry,
      );
    },
    markDownloadError: (fileId, error) => {
      errors.push({ fileId, error });
      files = files.map((entry) =>
        entry.id === fileId
          ? { ...entry, status: "error", downloadStatus: "error", downloadError: "download failed" }
          : entry,
      );
    },
    onSnapshot: (snapshot) => {
      snapshots.push(snapshot);
    },
    ...overrides,
  };
  const controller = createPlaylistDownloadController(deps);

  return {
    controller,
    snapshots,
    queued,
    canceled,
    errors,
    downloads,
    hydrations,
    timers,
    getFiles: () => files,
    setFiles: (nextFiles: TagiumFile[]) => {
      files = nextFiles;
    },
    setNow: (nextNow: number) => {
      now = nextNow;
    },
    fireTimer: (timerId: number) => {
      timers.get(timerId)?.();
    },
  };
};

describe("playlistDownloadController", () => {
  it("enqueue creates run, marks queued, publishes snapshot, and starts up to concurrency", () => {
    const harness = createHarness();

    harness.controller.enqueue([track("1"), track("2"), track("3")]);

    expect(harness.queued.map((entry) => entry.map((queuedTrack) => queuedTrack.fileId))).toEqual([
      ["1", "2", "3"],
    ]);
    expect(harness.controller.getSnapshot()).toMatchObject({
      id: 1,
      total: 3,
      pending: 1,
      active: [
        { fileId: "1", title: "Track 1" },
        { fileId: "2", title: "Track 2" },
      ],
    });
    expect(harness.downloads).toHaveLength(2);
  });

  it("successful download hydrates, marks completed, removes active, and pumps next", async () => {
    const first = createDeferred<File>();
    const second = createDeferred<File>();
    const downloads: Array<{
      request: QueuedDownloadTrack["downloadRequest"] & { signal: AbortSignal };
    }> = [];
    let downloadCount = 0;
    const downloadAudio = (
      request: QueuedDownloadTrack["downloadRequest"] & { signal: AbortSignal },
    ) => {
      downloads.push({ request });
      downloadCount += 1;
      if (downloadCount === 1) return first.promise;
      return second.promise;
    };
    const localHarness = createHarness({ concurrency: 1, downloadAudio });

    localHarness.controller.enqueue([track("1"), track("2")]);
    first.resolve(audioFile("first.mp3"));
    await flushPromises();
    await flushPromises();

    expect(localHarness.hydrations.map((entry) => entry.fileId)).toEqual(["1"]);
    expect(localHarness.controller.getSnapshot()).toMatchObject({
      completed: 1,
      active: [{ fileId: "2" }],
    });
    expect(downloads).toHaveLength(2);
  });

  it("missing file marks completed without download or hydrate", async () => {
    const harness = createHarness();
    harness.setFiles([]);

    harness.controller.enqueue([track("1")]);
    await flushPromises();

    expect(harness.downloads).toEqual([]);
    expect(harness.hydrations).toEqual([]);
    expect(harness.controller.getSnapshot()).toMatchObject({ completed: 1, done: true });
  });

  it("non-abort download or hydrate errors mark failed and call markDownloadError", async () => {
    const downloadError = new Error("network failed");
    const downloadHarness = createHarness({
      downloadAudio: async () => {
        throw downloadError;
      },
    });

    downloadHarness.controller.enqueue([track("1")]);
    await flushPromises();

    expect(downloadHarness.errors).toEqual([{ fileId: "1", error: downloadError }]);
    expect(downloadHarness.controller.getSnapshot()).toMatchObject({ failed: 1, done: true });

    const hydrateError = new Error("hydrate failed");
    const hydrateHarness = createHarness({
      hydrateDownloadedTrack: async () => {
        throw hydrateError;
      },
    });

    hydrateHarness.controller.enqueue([track("1")]);
    await flushPromises();
    await flushPromises();

    expect(hydrateHarness.errors).toEqual([{ fileId: "1", error: hydrateError }]);
    expect(hydrateHarness.controller.getSnapshot()).toMatchObject({ failed: 1, done: true });
  });

  it("cancel aborts active, cancels pending, marks files canceled, and eventually finishes", async () => {
    const first = createDeferred<File>();
    const second = createDeferred<File>();
    const harness = createHarness({
      downloadAudio: (request) => {
        if (request.sourceUrl.endsWith("/1")) return first.promise;
        return second.promise;
      },
    });

    harness.controller.enqueue([track("1"), track("2"), track("3")]);
    harness.controller.cancel();

    expect(harness.downloads.every((entry) => entry.request.signal.aborted)).toBe(true);
    expect(harness.canceled).toEqual([["1", "2"], ["3"], ["1", "2"]]);

    first.reject(new DOMException("playlist download canceled.", "AbortError"));
    second.reject(new DOMException("playlist download canceled.", "AbortError"));
    await flushPromises();

    expect(harness.controller.getSnapshot()).toMatchObject({
      canceled: true,
      canceledCount: 3,
      done: true,
    });
  });

  it("abort rejection marks canceled, not failed", async () => {
    const harness = createHarness({
      downloadAudio: async () => {
        throw new DOMException("aborted", "AbortError");
      },
    });

    harness.controller.enqueue([track("1")]);
    await flushPromises();

    expect(harness.errors).toEqual([]);
    expect(harness.controller.getSnapshot()).toMatchObject({
      failed: 0,
      canceledCount: 1,
      done: true,
    });
  });

  it("tunnel budget wait schedules wake and resumes after fake timer", () => {
    const harness = createHarness({ concurrency: 21 });
    harness.setFiles(Array.from({ length: 21 }, (_value, index) => file(`${index + 1}`)));
    harness.controller.enqueue(
      Array.from({ length: 21 }, (_value, index) => track(`${index + 1}`)),
    );

    expect(harness.controller.getSnapshot()).toMatchObject({
      waitingForTunnelBudget: true,
      active: expect.arrayContaining([{ fileId: "20", title: "Track 20", startedAt: 0 }]),
    });
    expect(harness.timers.size).toBe(1);

    harness.setNow(60_000);
    harness.fireTimer([...harness.timers.keys()][0]);

    expect(harness.controller.getSnapshot()).toMatchObject({
      waitingForTunnelBudget: false,
      active: expect.arrayContaining([{ fileId: "21", title: "Track 21", startedAt: 60_000 }]),
    });
  });

  it("retry requeues eligible failed/canceled/file-error tracks without duplicates and refuses while active", async () => {
    const failed = createDeferred<File>();
    const active = createDeferred<File>();
    const harness = createHarness({
      concurrency: 1,
      downloadAudio: (request) => {
        if (request.sourceUrl.endsWith("/1")) return Promise.reject(new Error("failed"));
        return request.sourceUrl.endsWith("/2") ? active.promise : failed.promise;
      },
    });

    harness.controller.enqueue([track("1"), track("2")]);
    await flushPromises();
    harness.controller.retry();
    expect(harness.queued).toHaveLength(1);

    harness.controller.cancel();
    active.reject(new DOMException("aborted", "AbortError"));
    await flushPromises();

    harness.setFiles([
      file("1", { status: "error", downloadStatus: "error" }),
      file("2", { downloadStatus: "canceled" }),
      file("3", { file: audioFile("done.mp3"), status: "saved" }),
    ]);
    harness.controller.retry();
    harness.controller.retry();

    expect(
      harness.queued.slice(1).map((entry) => entry.map((queuedTrack) => queuedTrack.fileId)),
    ).toEqual([["1", "2"]]);
    expect(harness.controller.getSnapshot()?.trackIds).toEqual(["1", "2"]);
  });

  it("dispose clears timer, aborts active work, and suppresses late async publish", async () => {
    const first = createDeferred<File>();
    const harness = createHarness({
      concurrency: 21,
      downloadAudio: (request) => {
        if (request.sourceUrl.endsWith("/1")) return first.promise;
        return Promise.resolve(audioFile());
      },
    });

    harness.setFiles(Array.from({ length: 21 }, (_value, index) => file(`${index + 1}`)));
    harness.controller.enqueue(
      Array.from({ length: 21 }, (_value, index) => track(`${index + 1}`)),
    );
    const snapshotCount = harness.snapshots.length;
    expect(harness.timers.size).toBe(1);

    harness.controller.dispose();

    expect(harness.timers.size).toBe(0);
    expect(harness.downloads.every((entry) => entry.request.signal.aborted)).toBe(true);

    first.resolve(audioFile());
    await flushPromises();
    await flushPromises();

    expect(harness.snapshots).toHaveLength(snapshotCount);
    expect(harness.errors).toEqual([]);
  });
});
