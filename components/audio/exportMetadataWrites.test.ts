import { describe, expect, it } from "vite-plus/test";
import { writeExportMetadata } from "./exportMetadataWrites";
import type { AudioMetadata, TagiumFile } from "./types";

const metadata = (title: string): AudioMetadata => ({
  filename: title,
  title,
  artist: "Artist",
  album: "Album",
  year: 2024,
  genre: "",
  duration: 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  trackNumber: null,
});

const readyFile = (id: string): TagiumFile => ({
  id,
  file: new File([id], `${id}.mp3`, { type: "audio/mpeg" }),
  filename: `${id}.mp3`,
  status: "pending",
  downloadStatus: "ready",
  metadata: metadata(id),
});

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("writeExportMetadata", () => {
  it("writes at most two files concurrently and completes every write before returning", async () => {
    const pendingWrites = new Map<string, ReturnType<typeof deferred>>();
    const started: string[] = [];
    let active = 0;
    let peakActive = 0;
    const writeFile = async (file: TagiumFile) => {
      started.push(file.id);
      active += 1;
      peakActive = Math.max(peakActive, active);
      const pendingWrite = deferred();
      pendingWrites.set(file.id, pendingWrite);
      await pendingWrite.promise;
      active -= 1;
    };

    let completed = false;
    const writeAll = writeExportMetadata(
      [readyFile("track-1"), readyFile("track-2"), readyFile("track-3"), readyFile("track-4")],
      writeFile,
    ).then(() => {
      completed = true;
    });
    await flushMicrotasks();

    expect(started).toEqual(["track-1", "track-2"]);
    expect(peakActive).toBe(2);
    expect(completed).toBe(false);

    pendingWrites.get("track-2")?.resolve();
    await flushMicrotasks();
    expect(started).toEqual(["track-1", "track-2", "track-3"]);

    pendingWrites.get("track-1")?.resolve();
    await flushMicrotasks();
    expect(started).toEqual(["track-1", "track-2", "track-3", "track-4"]);

    pendingWrites.get("track-3")?.resolve();
    pendingWrites.get("track-4")?.resolve();
    await writeAll;

    expect(peakActive).toBe(2);
    expect(completed).toBe(true);
  });

  it("waits for in-flight work, stops scheduling, and propagates a write rejection", async () => {
    const pendingWrites = new Map<string, ReturnType<typeof deferred>>();
    const started: string[] = [];
    const writeError = new Error("metadata write failed");
    const writeAll = writeExportMetadata(
      [readyFile("track-1"), readyFile("track-2"), readyFile("track-3")],
      (file) => {
        started.push(file.id);
        const pendingWrite = deferred();
        pendingWrites.set(file.id, pendingWrite);
        return pendingWrite.promise;
      },
    );
    let settled = false;
    const outcome = writeAll.then(
      () => {
        settled = true;
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await flushMicrotasks();

    pendingWrites.get("track-2")?.reject(writeError);
    await flushMicrotasks();

    expect(settled).toBe(false);
    expect(started).toEqual(["track-1", "track-2"]);

    pendingWrites.get("track-1")?.resolve();

    expect(await outcome).toBe(writeError);
    expect(started).toEqual(["track-1", "track-2"]);
  });

  it("reports the earliest-started failure after all in-flight writes settle", async () => {
    const pendingWrites = new Map<string, ReturnType<typeof deferred>>();
    const started: string[] = [];
    const firstError = new Error("first write failed");
    const secondError = new Error("second write failed");
    const outcome = writeExportMetadata(
      [readyFile("track-1"), readyFile("track-2"), readyFile("track-3")],
      (file) => {
        started.push(file.id);
        const pendingWrite = deferred();
        pendingWrites.set(file.id, pendingWrite);
        return pendingWrite.promise;
      },
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    await flushMicrotasks();

    pendingWrites.get("track-2")?.reject(secondError);
    await flushMicrotasks();
    expect(started).toEqual(["track-1", "track-2"]);

    pendingWrites.get("track-1")?.reject(firstError);

    expect(await outcome).toBe(firstError);
    expect(started).toEqual(["track-1", "track-2"]);
  });

  it("skips files without both audio and metadata, including an empty selection", async () => {
    const noAudio: TagiumFile = { ...readyFile("no-audio"), file: undefined };
    const noMetadata: TagiumFile = { ...readyFile("no-metadata"), metadata: undefined };
    const eligible = readyFile("eligible");
    const writes: Array<{ id: string; metadata: AudioMetadata }> = [];

    await writeExportMetadata([noAudio, noMetadata, eligible], async (file, fileMetadata) => {
      writes.push({ id: file.id, metadata: fileMetadata });
    });
    await writeExportMetadata([], async () => {
      throw new Error("empty exports must not invoke the writer");
    });

    expect(writes).toEqual([{ id: "eligible", metadata: eligible.metadata }]);
  });
});
