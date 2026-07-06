import { describe, expect, it } from "vite-plus/test";
import { createMetadataWriteCoordinator } from "./metadataWriteCoordinator";
import type { UploadedTrack } from "./mp3Utils";
import type { AudioMetadata, MetadataPatch, TagiumFile } from "./types";

const metadata = (overrides: Partial<AudioMetadata> = {}): AudioMetadata => ({
  filename: "track",
  title: "Track",
  artist: "Artist",
  album: "Album",
  year: 2024,
  genre: "",
  duration: 100,
  bitrate: 320,
  sampleRate: 44_100,
  picture: [],
  trackNumber: 1,
  ...overrides,
});

const file = (overrides: Partial<TagiumFile> = {}): TagiumFile => ({
  id: "track-1",
  file: new File(["current"], "track.mp3", { type: "audio/mpeg" }),
  originalFile: new File(["current"], "track.mp3", { type: "audio/mpeg" }),
  filename: "track.mp3",
  status: "pending",
  downloadStatus: "downloading",
  hasBufferedChanges: false,
  metadata: metadata(),
  ...overrides,
});

const upload = (parsedFile: TagiumFile): UploadedTrack => ({
  file: parsedFile,
  albumSeed: {
    title: "",
    artist: "",
    genre: "",
  },
});

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

const createHarness = ({
  currentFile = file(),
  parsedFile = file({
    file: new File(["parsed"], "track.mp3", { type: "audio/mpeg" }),
    originalFile: new File(["parsed"], "track.mp3", { type: "audio/mpeg" }),
    downloadStatus: "ready",
  }),
  parsedUpload = upload(parsedFile),
  formMetadata,
  dirtyFields = {},
  syncFilenames = false,
}: {
  currentFile?: TagiumFile | undefined;
  parsedFile?: TagiumFile;
  parsedUpload?: UploadedTrack | undefined;
  formMetadata?: AudioMetadata | undefined;
  dirtyFields?: Partial<Record<keyof AudioMetadata, unknown>>;
  syncFilenames?: boolean;
} = {}) => {
  const latestFiles = new Map<string, TagiumFile>();
  if (currentFile) latestFiles.set(currentFile.id, currentFile);

  const commits: TagiumFile[] = [];
  const calls: string[] = [];
  const writeMetadataCalls: { file: TagiumFile; metadata: AudioMetadata }[] = [];
  let selectedFormMetadata = formMetadata;
  let dirty = dirtyFields;
  let nextParseUpload: UploadedTrack | undefined = parsedUpload;
  let writeMetadata = async (_file: TagiumFile, metadataToWrite: AudioMetadata) =>
    new File(["updated"], `${metadataToWrite.filename}.mp3`, { type: "audio/mpeg" });

  const coordinator = createMetadataWriteCoordinator({
    parseDownloadedFile: async () => {
      calls.push("parse");
      return nextParseUpload;
    },
    writeMetadata: async (hydratedFile, metadataToWrite) => {
      calls.push("write");
      writeMetadataCalls.push({ file: hydratedFile, metadata: metadataToWrite });
      return writeMetadata(hydratedFile, metadataToWrite);
    },
    getLatestFile: (fileId) => {
      calls.push("latest");
      return latestFiles.get(fileId);
    },
    getSelectedDirtyFormMetadata: () => {
      calls.push("form");
      return selectedFormMetadata;
    },
    getDirtyMetadataFields: () => dirty,
    getSyncFilenames: () => syncFilenames,
    commitHydratedFile: (fileId, hydratedFile) => {
      calls.push("commit");
      commits.push(hydratedFile);
      latestFiles.set(fileId, hydratedFile);
    },
  });

  return {
    calls,
    commits,
    coordinator,
    latestFiles,
    setDirtyFields: (nextDirtyFields: Partial<Record<keyof AudioMetadata, unknown>>) => {
      dirty = nextDirtyFields;
    },
    setFormMetadata: (nextFormMetadata: AudioMetadata | undefined) => {
      selectedFormMetadata = nextFormMetadata;
    },
    setParsedUpload: (nextParsedUpload: UploadedTrack | undefined) => {
      nextParseUpload = nextParsedUpload;
    },
    setWriteMetadata: (nextWriteMetadata: typeof writeMetadata) => {
      writeMetadata = nextWriteMetadata;
    },
    writeMetadataCalls,
  };
};

describe("metadataWriteCoordinator", () => {
  it("commits a ready file when hydration does not need a metadata write", async () => {
    const currentFile = file();
    const parsedFile = file({
      file: new File(["parsed"], "track.mp3", { type: "audio/mpeg" }),
      originalFile: new File(["parsed"], "track.mp3", { type: "audio/mpeg" }),
      downloadStatus: "ready",
    });
    const harness = createHarness({ currentFile, parsedFile });

    await harness.coordinator.hydrateDownloadedTrack({
      fileId: currentFile.id,
      downloadedFile: new File(["download"], "download.mp3"),
    });

    expect(harness.writeMetadataCalls).toHaveLength(0);
    expect(harness.commits).toHaveLength(1);
    expect(harness.commits[0]).toMatchObject({
      file: parsedFile.file,
      originalFile: parsedFile.originalFile,
      status: "pending",
      downloadStatus: "ready",
      hasBufferedChanges: false,
      pendingMetadataPatch: undefined,
    });
  });

  it("writes metadata and commits saved cleared-pending state when latest is unchanged", async () => {
    const currentFile = file({
      hasBufferedChanges: true,
      metadata: metadata({ title: "Edited" }),
    });
    const parsedFile = file({
      file: new File(["parsed"], "parsed.mp3", { type: "audio/mpeg" }),
      originalFile: new File(["parsed"], "parsed.mp3", { type: "audio/mpeg" }),
      filename: "parsed.mp3",
      downloadStatus: "ready",
      metadata: metadata({ filename: "parsed", title: "Parsed" }),
    });
    const harness = createHarness({ currentFile, parsedFile });

    await harness.coordinator.hydrateDownloadedTrack({
      fileId: currentFile.id,
      downloadedFile: new File(["download"], "download.mp3"),
    });

    expect(harness.writeMetadataCalls[0]?.metadata.title).toBe("Edited");
    expect(harness.commits[0]).toMatchObject({
      status: "saved",
      downloadStatus: "ready",
      hasBufferedChanges: false,
      pendingMetadataPatch: undefined,
    });
    expect(harness.commits[0]?.file?.name).toBe("track.mp3");
  });

  it("captures dirty selected form metadata before prepare", async () => {
    const currentFile = file({ metadata: metadata({ title: "Provider" }) });
    const parsedFile = file({ metadata: metadata({ title: "Parsed" }) });
    const formMetadata = metadata({ title: "Dirty Title", year: Number.NaN });
    const harness = createHarness({
      currentFile,
      parsedFile,
      formMetadata,
      dirtyFields: { title: true, year: true },
    });

    await harness.coordinator.hydrateDownloadedTrack({
      fileId: currentFile.id,
      downloadedFile: new File(["download"], "download.mp3"),
    });

    expect(harness.writeMetadataCalls[0]?.metadata).toMatchObject({
      title: "Dirty Title",
      year: null,
    });
    expect(harness.writeMetadataCalls[0]?.file.pendingMetadataPatch).toEqual({
      title: "Dirty Title",
      year: null,
    } satisfies MetadataPatch);
  });

  it("re-reads latest file and dirty form after async write, preserving stale edits", async () => {
    const currentFile = file({
      pendingMetadataPatch: { title: "Initial Dirty" },
      hasBufferedChanges: true,
      metadata: metadata({ title: "Initial Dirty" }),
    });
    const parsedFile = file({ metadata: metadata({ title: "Parsed" }) });
    const harness = createHarness({ currentFile, parsedFile });
    const write = createDeferred<File>();
    harness.setWriteMetadata(() => write.promise);

    const hydration = harness.coordinator.hydrateDownloadedTrack({
      fileId: currentFile.id,
      downloadedFile: new File(["download"], "download.mp3"),
    });
    await Promise.resolve();
    harness.latestFiles.set(
      currentFile.id,
      file({
        id: currentFile.id,
        metadata: metadata({ title: "Latest File" }),
        pendingMetadataPatch: { artist: "Latest Artist" },
        hasBufferedChanges: true,
      }),
    );
    harness.setFormMetadata(metadata({ title: "Latest Dirty", artist: "Form Artist" }));
    harness.setDirtyFields({ title: true, artist: true });
    write.resolve(new File(["updated"], "updated.mp3", { type: "audio/mpeg" }));
    await hydration;

    expect(harness.commits[0]).toMatchObject({
      status: "pending",
      hasBufferedChanges: true,
      pendingMetadataPatch: {
        artist: "Form Artist",
        title: "Latest Dirty",
      },
    });
    expect(harness.commits[0]?.metadata).toMatchObject({
      title: "Latest Dirty",
      artist: "Form Artist",
      duration: parsedFile.metadata?.duration,
    });
  });

  it("commits error state and pending patch when metadata write fails", async () => {
    const currentFile = file({
      pendingMetadataPatch: { title: "Edited" },
      hasBufferedChanges: true,
      metadata: metadata({ title: "Edited" }),
    });
    const parsedFile = file({
      file: new File(["parsed"], "parsed.mp3", { type: "audio/mpeg" }),
      originalFile: new File(["parsed"], "parsed.mp3", { type: "audio/mpeg" }),
      metadata: metadata({ title: "Parsed", duration: 222 }),
    });
    const harness = createHarness({ currentFile, parsedFile });
    harness.setWriteMetadata(async () => {
      throw new Error("writer failed");
    });

    await harness.coordinator.hydrateDownloadedTrack({
      fileId: currentFile.id,
      downloadedFile: new File(["download"], "download.mp3"),
    });

    expect(harness.commits[0]).toMatchObject({
      file: parsedFile.file,
      originalFile: parsedFile.originalFile,
      status: "error",
      downloadStatus: "ready",
      downloadError: "writer failed",
      hasBufferedChanges: true,
      pendingMetadataPatch: { title: "Edited" },
    });
    expect(harness.commits[0]?.metadata?.duration).toBe(222);
  });

  it("returns without commit when current or latest file is missing", async () => {
    const missingCurrent = createHarness({ currentFile: undefined });
    await missingCurrent.coordinator.hydrateDownloadedTrack({
      fileId: "missing",
      downloadedFile: new File(["download"], "download.mp3"),
    });
    expect(missingCurrent.commits).toHaveLength(0);

    const currentFile = file({
      pendingMetadataPatch: { title: "Edited" },
      hasBufferedChanges: true,
      metadata: metadata({ title: "Edited" }),
    });
    const missingLatest = createHarness({
      currentFile,
      parsedFile: file({ metadata: metadata({ title: "Parsed" }) }),
    });
    missingLatest.setWriteMetadata(async () => {
      missingLatest.latestFiles.delete(currentFile.id);
      return new File(["updated"], "updated.mp3", { type: "audio/mpeg" });
    });

    await missingLatest.coordinator.hydrateDownloadedTrack({
      fileId: currentFile.id,
      downloadedFile: new File(["download"], "download.mp3"),
    });
    expect(missingLatest.commits).toHaveLength(0);
  });

  it('throws when parse returns undefined with "downloaded track could not be parsed."', async () => {
    const harness = createHarness();
    harness.setParsedUpload(undefined);

    await expect(
      harness.coordinator.hydrateDownloadedTrack({
        fileId: "track-1",
        downloadedFile: new File(["download"], "download.mp3"),
      }),
    ).rejects.toThrow("downloaded track could not be parsed.");
    expect(harness.commits).toHaveLength(0);
  });

  it("prevents commit when aborted before parse or after async write", async () => {
    const beforeParse = createHarness();
    const beforeParseAbort = new AbortController();
    beforeParseAbort.abort();

    await expect(
      beforeParse.coordinator.hydrateDownloadedTrack({
        fileId: "track-1",
        downloadedFile: new File(["download"], "download.mp3"),
        signal: beforeParseAbort.signal,
      }),
    ).rejects.toThrow();
    expect(beforeParse.calls).not.toContain("parse");
    expect(beforeParse.commits).toHaveLength(0);

    const afterWrite = createHarness({
      currentFile: file({
        pendingMetadataPatch: { title: "Edited" },
        hasBufferedChanges: true,
        metadata: metadata({ title: "Edited" }),
      }),
      parsedFile: file({ metadata: metadata({ title: "Parsed" }) }),
    });
    const write = createDeferred<File>();
    const afterWriteAbort = new AbortController();
    afterWrite.setWriteMetadata(() => write.promise);
    const hydration = afterWrite.coordinator.hydrateDownloadedTrack({
      fileId: "track-1",
      downloadedFile: new File(["download"], "download.mp3"),
      signal: afterWriteAbort.signal,
    });
    await Promise.resolve();
    afterWriteAbort.abort();
    write.resolve(new File(["updated"], "updated.mp3", { type: "audio/mpeg" }));

    await expect(hydration).rejects.toThrow();
    expect(afterWrite.commits).toHaveLength(0);
  });
});
