import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { resetCobaltDownloadSchedulerForTests } from "@/shared/cobalt/cobaltDownloadScheduler";
import {
  downloadVideoPickerItem,
  executeVideoDownload,
  resolveVideoDownload,
  startVideoDownload,
  VideoDownloadError,
} from "@/apps/tagium-save/download/videoDownload";

const tunnelPlan = (filename = "clip.mp4") => ({
  status: "tunnel",
  url: "/api/cobalt/tunnel?id=clip",
  filename,
});

const localProcessingPlan = () => ({
  status: "local-processing" as const,
  type: "merge" as const,
  tunnel: ["/api/cobalt/tunnel?id=video", "/api/cobalt/tunnel?id=audio"],
  output: { type: "video/mp4", filename: "clip.mp4" },
});

const workerOutputEntryName = "tagium-video-output-worker";

const installFakeOpfs = () => {
  const removedEntries: string[] = [];
  const entries = new Map<string, Uint8Array>();
  const root = {
    getFileHandle: async (name: string) => ({
      createWritable: async () => ({
        write: async (write: { position?: number; data?: BufferSource }) => {
          const data = new Uint8Array(
            write.data instanceof ArrayBuffer
              ? write.data
              : (write.data?.buffer ?? new ArrayBuffer(0)),
          );
          const position = write.position ?? 0;
          const previous = entries.get(name) ?? new Uint8Array();
          const next = new Uint8Array(Math.max(previous.byteLength, position + data.byteLength));
          next.set(previous);
          next.set(data, position);
          entries.set(name, next);
        },
        close: async () => undefined,
      }),
      getFile: async () => {
        const bytes = entries.get(name) ?? new Uint8Array();
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        return new File([buffer], name);
      },
    }),
    removeEntry: vi.fn(async (name: string) => {
      removedEntries.push(name);
      entries.delete(name);
    }),
  };
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => root } });
  return { entries, removedEntries, root };
};

const installControllableWorker = () => {
  class ControllableWorker {
    static instance: ControllableWorker | undefined;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    readonly postMessage = vi.fn();
    readonly terminate = vi.fn();

    constructor() {
      ControllableWorker.instance = this;
    }

    complete() {
      this.onmessage?.(
        new MessageEvent("message", {
          data: {
            cobaltVideoProcessing: {
              blob: new Blob(["processed"]),
              opfsEntryName: workerOutputEntryName,
            },
          },
        }),
      );
    }

    fail(message = "ffmpeg failed") {
      this.onmessage?.(
        new MessageEvent("message", {
          data: { cobaltVideoProcessing: { error: message } },
        }),
      );
    }
  }

  vi.stubGlobal("Worker", ControllableWorker);
  return ControllableWorker;
};

afterEach(() => {
  resetCobaltDownloadSchedulerForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("video download routing", () => {
  it("requests a plan, streams a tunnel into a file, and reports phases", async () => {
    const progress: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/cobalt/download") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.localProcessing).toBe("forced");
        expect(body.alwaysProxy).toBe(true);
        return Response.json(tunnelPlan());
      }
      return new Response("video-bytes", {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": "11",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const task = startVideoDownload(
      { sourceUrl: "https://example.test/watch/clip", videoQuality: "720" },
      { onProgress: (event) => progress.push(event.phase) },
    );
    const result = await task.promise;

    expect(result.status).toBe("file");
    if (result.status === "file") {
      expect(result.file.name).toBe("clip.mp4");
      expect(result.file.type).toBe("video/mp4");
      expect(await result.file.text()).toBe("video-bytes");
    }
    expect(progress).toEqual(["planning", "waiting-for-tunnel", "downloading", "finalizing"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("paces rapid video tunnels instead of surfacing a limit failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    let nextPlanId = 0;
    let lastTunnelStart = Number.NEGATIVE_INFINITY;
    const tunnelStartTimes: number[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/cobalt/download") {
        nextPlanId += 1;
        return Response.json(tunnelPlan(`clip-${nextPlanId}.mp4`));
      }

      const startedAt = Date.now();
      tunnelStartTimes.push(startedAt);
      if (startedAt - lastTunnelStart < 1_600) {
        return new Response("tunnel start limit exceeded", { status: 429 });
      }
      lastTunnelStart = startedAt;
      return new Response("video-bytes", { headers: { "Content-Type": "video/mp4" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const downloads = Promise.all([
      startVideoDownload({ sourceUrl: "https://example.test/watch/one" }).promise,
      startVideoDownload({ sourceUrl: "https://example.test/watch/two" }).promise,
    ]);

    const assertion = expect(downloads).resolves.toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
    expect(tunnelStartTimes.map((time) => time - tunnelStartTimes[0]!)).toEqual([0, 1_600]);
  });

  it("queues the twenty-first video plan until Tagium's admission window renews", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const fetchMock = vi.fn(async () => Response.json(tunnelPlan()));
    vi.stubGlobal("fetch", fetchMock);

    const resolutions = Promise.all(
      Array.from({ length: 21 }, (_value, index) =>
        resolveVideoDownload({ sourceUrl: `https://example.test/watch/${index}` }),
      ),
    );
    const assertion = expect(resolutions).resolves.toHaveLength(21);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(20);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(20);

    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(21);
  });

  it("downloads picker media and its separate audio through the same endpoint", async () => {
    const picker = {
      status: "picker",
      picker: [
        {
          type: "video",
          url: "/api/cobalt/tunnel?id=selected",
          thumb: "https://cdn.example/thumb.jpg",
        },
      ],
      audio: "/api/cobalt/tunnel?id=audio",
      audioFilename: "post-audio.mp3",
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/cobalt/download") {
        return Response.json(picker);
      }
      return new Response("selected-bytes", { headers: { "Content-Type": "video/mp4" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pickerTask = startVideoDownload({ sourceUrl: "https://example.test/post" });
    const pickerResult = await pickerTask.promise;
    expect(pickerResult.status).toBe("picker");
    if (pickerResult.status !== "picker") return;

    const selectedTask = pickerResult.download(pickerResult.picker[0]!);
    const selected = await selectedTask.promise;
    expect(selected.file.name).toBe("tagium-video.mp4");
    expect(await selected.file.text()).toBe("selected-bytes");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/cobalt/tunnel?id=selected");

    expect(pickerResult.audioFilename).toBe("post-audio.mp3");
    expect(pickerResult.downloadAudio).toBeDefined();
    const audioTask = pickerResult.downloadAudio?.();
    expect(audioTask).toBeDefined();
    const audio = await audioTask!.promise;
    expect(audio.file.name).toBe("post-audio.mp3");
    expect(await audio.file.text()).toBe("selected-bytes");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/cobalt/tunnel?id=audio");
  });

  it("rejects malformed plans before fetching a tunnel", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ status: "tunnel", url: 123, filename: "clip.mp4" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const task = startVideoDownload({ sourceUrl: "https://example.test/malformed" });
    await expect(task.promise).rejects.toMatchObject({
      stage: "planning",
      message: "cobalt returned an invalid download plan.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("aborts an in-flight tunnel request and exposes a clear error", async () => {
    let rejectFetch: ((reason?: unknown) => void) | undefined;
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/cobalt/download") return Promise.resolve(Response.json(tunnelPlan()));
      return new Promise<Response>((_resolve, reject) => {
        rejectFetch = reject;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const task = startVideoDownload({ sourceUrl: "https://example.test/cancel" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    task.abort();
    rejectFetch?.(new DOMException("aborted", "AbortError"));
    await expect(task.promise).rejects.toBeInstanceOf(VideoDownloadError);
    await expect(task.promise).rejects.toMatchObject({ message: "download cancelled." });
  });

  it("preserves non-abort browser errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("storage access denied", "SecurityError");
      }),
    );

    const task = startVideoDownload({ sourceUrl: "https://example.test/security-error" });

    await expect(task.promise).rejects.toMatchObject({
      stage: "planning",
      message: "storage access denied",
    });
  });

  it("supports the standalone picker item helper", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("item", { headers: { "Content-Type": "video/mp4" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const task = downloadVideoPickerItem(
      { sourceUrl: "https://example.test/post" },
      { type: "video", url: "/api/cobalt/tunnel?id=item" },
    );
    const result = await task.promise;
    expect(result.file.name).toBe("tagium-video.mp4");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("supports resolving a plan before executing it", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/cobalt/download") return Response.json(tunnelPlan("resolved.mp4"));
      return new Response("resolved", { headers: { "Content-Type": "video/mp4" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const plan = await resolveVideoDownload({ sourceUrl: "https://example.test/resolved" });
    const file = await executeVideoDownload(plan);
    if (file instanceof Blob) {
      expect(await file.text()).toBe("resolved");
    } else if (file.status === "file") {
      expect(await file.file.text()).toBe("resolved");
    }
  });

  it("keeps local-processing inputs leased until the worker completes", async () => {
    vi.useFakeTimers();
    const { entries, removedEntries } = installFakeOpfs();
    const WorkerFake = installControllableWorker();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("input", { headers: { "Content-Type": "video/mp4" } })),
    );

    const download = executeVideoDownload(localProcessingPlan());
    await vi.advanceTimersByTimeAsync(2_000);

    expect(WorkerFake.instance?.postMessage).toHaveBeenCalledOnce();
    expect(removedEntries).toEqual([]);

    entries.set(workerOutputEntryName, new TextEncoder().encode("processed"));
    WorkerFake.instance?.complete();
    const result = await download;
    expect(result.status).toBe("file");
    expect(removedEntries).toHaveLength(2);
    expect(removedEntries).not.toContain(workerOutputEntryName);
    expect(entries.has(workerOutputEntryName)).toBe(true);

    if (result.status === "file") {
      expect(await result.file.text()).toBe("processed");
      await result.release();
      await result.release();
    }
    expect(removedEntries).toHaveLength(3);
    expect(removedEntries.filter((name) => name === workerOutputEntryName)).toHaveLength(1);
    expect(entries.has(workerOutputEntryName)).toBe(false);
  });

  it("releases local-processing inputs when the worker fails", async () => {
    vi.useFakeTimers();
    const { removedEntries } = installFakeOpfs();
    const WorkerFake = installControllableWorker();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("input", { headers: { "Content-Type": "video/mp4" } })),
    );

    const download = executeVideoDownload(localProcessingPlan());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(removedEntries).toEqual([]);

    WorkerFake.instance?.fail();
    await expect(download).rejects.toMatchObject({
      stage: "processing",
      message: "ffmpeg failed",
    });
    expect(removedEntries).toHaveLength(2);
  });

  it("releases completed inputs when another concurrent tunnel fails", async () => {
    vi.useFakeTimers();
    const { removedEntries } = installFakeOpfs();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("video")
          ? new Response("input", { headers: { "Content-Type": "video/mp4" } })
          : new Response("upstream failed", { status: 502 }),
      ),
    );

    const download = executeVideoDownload(localProcessingPlan());
    const assertion = expect(download).rejects.toMatchObject({ stage: "tunnel" });
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;

    expect(removedEntries).toHaveLength(1);
  });
});
