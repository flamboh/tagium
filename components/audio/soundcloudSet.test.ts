import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createSingleUrlDownloadPlan,
  createSoundCloudSetDownloadPlan,
  startDownloadTrackPlan,
  type QueuedDownloadTrack,
} from "./downloadTrack";
import { resolveSoundCloudSet } from "./soundcloudSet";
import { startSoundCloudSetImport } from "./soundcloudSetImport";
import type { SoundCloudSet } from "./soundcloudSet";
import type { AlbumGroup, AppSettings, AudioMetadata, TagiumFile } from "./types";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve: Deferred<T>["resolve"] = () => {};
  let reject: Deferred<T>["reject"] = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const cover: AudioMetadata["picture"] = [
  {
    format: "image/jpeg",
    type: 3,
    description: "soundcloud cover",
    data: new Uint8Array([1, 2, 3]),
  },
];

const defaultSettings: AppSettings = {
  audioBitrate: "320",
  syncFilenames: false,
  syncTrackNumbers: false,
  applySoundCloudAlbumCoverToTracks: true,
};

const soundCloudSet = (overrides: Partial<SoundCloudSet> = {}): SoundCloudSet => ({
  title: "Imported Set",
  artist: "Set Artist",
  genre: "Electronic",
  year: 2024,
  isAlbum: true,
  coverUrl: "https://img.example/cover.jpg",
  tracks: [
    {
      title: "First Track",
      url: "https://soundcloud.com/artist/first-track",
      duration: 101,
      trackNumber: 1,
    },
    {
      title: "Second Track",
      url: "https://soundcloud.com/artist/second-track",
      duration: 102,
      trackNumber: 2,
    },
  ],
  ...overrides,
});

describe("resolveSoundCloudSet", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects decoded tracks with malformed URLs", async () => {
    vi.stubGlobal("window", {
      location: {
        origin: "https://tagium.test",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          title: "Imported Set",
          artist: "Set Artist",
          genre: "Electronic",
          isAlbum: true,
          tracks: [
            {
              title: "Broken Track",
              url: "not-a-url",
              trackNumber: 1,
            },
          ],
        }),
      ),
    );

    await expect(resolveSoundCloudSet("https://soundcloud.com/artist/sets/set")).rejects.toThrow();
  });
});

const createHarness = (settings: AppSettings = defaultSettings) => {
  let files: TagiumFile[] = [];
  let albums: AlbumGroup[] = [];
  let activeView = "";
  let selectedAlbumId: string | null = null;
  let selectedFileId: string | null = null;
  let selectedFileIds = new Set<string>();
  let lastSelectedFileId: string | null = null;
  let bufferCount = 0;
  const events: string[] = [];
  const queuedTracks: QueuedDownloadTrack[] = [];
  const updateTagsCalls: string[] = [];
  const coverRequest = deferred<AudioMetadata["picture"]>();
  const ids = ["album-1", "track-1", "track-2"];

  const start = (set: SoundCloudSet) =>
    startSoundCloudSetImport(set, {
      settings,
      bufferCurrentFormMetadata: () => {
        bufferCount++;
      },
      setActiveView: (view) => {
        activeView = view;
      },
      getFiles: () => files,
      setFiles: (nextFiles) => {
        files = nextFiles;
      },
      getAlbums: () => albums,
      setAlbums: (nextAlbums) => {
        albums = nextAlbums;
      },
      setSelectedAlbumId: (albumId) => {
        selectedAlbumId = albumId;
      },
      setSelectedFileId: (fileId) => {
        selectedFileId = fileId;
      },
      setSelectedFileIds: (fileIds) => {
        selectedFileIds = fileIds;
      },
      setLastSelectedFileId: (fileId) => {
        lastSelectedFileId = fileId;
      },
      createId: () => {
        const id = ids.shift();
        if (!id) throw new Error("missing test id");
        return id;
      },
      fetchImportedCover: (coverUrl) => {
        events.push(`cover:${coverUrl}`);
        return coverRequest.promise;
      },
      queueDownloadTracks: (tracks) => {
        queuedTracks.push(...tracks);
      },
      updateTags: async (file) => {
        updateTagsCalls.push(file.id);
      },
      warn: () => {},
    });

  const markDownloaded = (fileId: string) => {
    const downloadedFile = new File([fileId], `${fileId}.mp3`, { type: "audio/mpeg" });
    files = files.map((file) =>
      file.id === fileId
        ? {
            ...file,
            file: downloadedFile,
            originalFile: downloadedFile,
            status: file.hasBufferedChanges ? "pending" : "saved",
            downloadStatus: "ready",
          }
        : file,
    );
  };

  return {
    get activeView() {
      return activeView;
    },
    get albums() {
      return albums;
    },
    get bufferCount() {
      return bufferCount;
    },
    coverRequest,
    events,
    get files() {
      return files;
    },
    get lastSelectedFileId() {
      return lastSelectedFileId;
    },
    markDownloaded,
    get queuedTracks() {
      return queuedTracks;
    },
    get selectedAlbumId() {
      return selectedAlbumId;
    },
    get selectedFileId() {
      return selectedFileId;
    },
    get selectedFileIds() {
      return selectedFileIds;
    },
    start,
    updateTagsCalls,
  };
};

describe("download track plans", () => {
  it("applies a single URL plan through the shared download workflow", () => {
    let files: TagiumFile[] = [];
    let activeView = "";
    let selectedAlbumId: string | null = "album-before";
    let selectedFileId: string | null = "file-before";
    let selectedFileIds = new Set(["file-before"]);
    let lastSelectedFileId: string | null = "file-before";
    let bufferCount = 0;
    let looseTrackIds = ["existing-track", "single-track"];
    let queuedTracks: QueuedDownloadTrack[] = [];
    let filesVisibleWhenQueued: string[] = [];

    const plan = createSingleUrlDownloadPlan({
      sourceUrl: "https://soundcloud.com/artist/direct-track",
      audioBitrate: "320",
      createId: () => "single-track",
    });

    startDownloadTrackPlan(plan, {
      bufferCurrentFormMetadata: () => {
        bufferCount++;
      },
      setActiveView: (view) => {
        activeView = view;
      },
      getFiles: () => files,
      setFiles: (nextFiles) => {
        files = nextFiles;
      },
      setSelectedAlbumId: (albumId) => {
        selectedAlbumId = albumId;
      },
      setSelectedFileId: (fileId) => {
        selectedFileId = fileId;
      },
      setSelectedFileIds: (fileIds) => {
        selectedFileIds = fileIds;
      },
      setLastSelectedFileId: (fileId) => {
        lastSelectedFileId = fileId;
      },
      queueDownloadTracks: (tracks) => {
        filesVisibleWhenQueued = files.map((file) => file.id);
        queuedTracks = tracks;
      },
      addLooseTrackIds: (trackIds) => {
        looseTrackIds = [...new Set([...looseTrackIds, ...trackIds])];
      },
    });

    expect(bufferCount).toBe(1);
    expect(activeView).toBe("editor");
    expect(files.map((file) => file.id)).toEqual(["single-track"]);
    expect(files[0].downloadRequest).toEqual({
      sourceUrl: "https://soundcloud.com/artist/direct-track",
      audioBitrate: "320",
    });
    expect(looseTrackIds).toEqual(["existing-track", "single-track"]);
    expect(selectedAlbumId).toBeNull();
    expect(selectedFileId).toBe("single-track");
    expect([...selectedFileIds]).toEqual(["single-track"]);
    expect(lastSelectedFileId).toBe("single-track");
    expect(filesVisibleWhenQueued).toEqual(["single-track"]);
    expect(queuedTracks).toEqual(plan.queuedTracks);
  });

  it("creates the same queued track shape for single URL and SoundCloud set plans", () => {
    const singlePlan = createSingleUrlDownloadPlan({
      sourceUrl: "https://soundcloud.com/artist/direct-track",
      audioBitrate: "320",
      createId: () => "single-track",
    });
    const ids = ["album-1", "set-track-1", "set-track-2"];
    const setPlan = createSoundCloudSetDownloadPlan({
      set: soundCloudSet(),
      audioBitrate: "320",
      createId: () => {
        const id = ids.shift();
        if (!id) throw new Error("missing test id");
        return id;
      },
    });

    expect(singlePlan.queuedTracks).toEqual([
      {
        fileId: "single-track",
        title: "direct track",
        downloadRequest: {
          sourceUrl: "https://soundcloud.com/artist/direct-track",
          audioBitrate: "320",
        },
      },
    ]);
    expect(singlePlan.pendingFiles[0].hasBufferedChanges).toBe(false);
    expect(singlePlan.pendingFiles[0].pendingMetadataPatch).toBeUndefined();
    expect(Object.keys(singlePlan.queuedTracks[0]).sort()).toEqual(
      Object.keys(setPlan.queuedTracks[0]).sort(),
    );
    expect(setPlan.pendingFiles.map((file) => file.pendingMetadataPatch)).toEqual([
      {
        title: "First Track",
        artist: "Set Artist",
        album: "Imported Set",
        genre: "Electronic",
        year: 2024,
        trackNumber: 1,
      },
      {
        title: "Second Track",
        artist: "Set Artist",
        album: "Imported Set",
        genre: "Electronic",
        year: 2024,
        trackNumber: 2,
      },
    ]);
    expect(setPlan.queuedTracks).toEqual([
      {
        fileId: "set-track-1",
        title: "First Track",
        downloadRequest: {
          sourceUrl: "https://soundcloud.com/artist/first-track",
          audioBitrate: "320",
        },
      },
      {
        fileId: "set-track-2",
        title: "Second Track",
        downloadRequest: {
          sourceUrl: "https://soundcloud.com/artist/second-track",
          audioBitrate: "320",
        },
      },
    ]);
  });
});

describe("soundcloud set import", () => {
  it("imports an album plan, queues shared download tracks, and applies cover to downloaded files", async () => {
    const harness = createHarness();

    harness.start(soundCloudSet());

    expect(harness.bufferCount).toBe(1);
    expect(harness.activeView).toBe("editor");
    expect(harness.selectedAlbumId).toBe("album-1");
    expect(harness.selectedFileId).toBe("track-1");
    expect([...harness.selectedFileIds]).toEqual(["track-1"]);
    expect(harness.lastSelectedFileId).toBe("track-1");
    expect(harness.albums).toEqual([
      {
        id: "album-1",
        title: "Imported Set",
        artist: "Set Artist",
        genre: "Electronic",
        trackIds: ["track-1", "track-2"],
        year: 2024,
      },
    ]);
    expect(harness.files.map((file) => file.downloadRequest)).toEqual([
      { sourceUrl: "https://soundcloud.com/artist/first-track", audioBitrate: "320" },
      { sourceUrl: "https://soundcloud.com/artist/second-track", audioBitrate: "320" },
    ]);
    expect(harness.files.map((file) => file.pendingMetadataPatch)).toEqual([
      {
        title: "First Track",
        artist: "Set Artist",
        album: "Imported Set",
        genre: "Electronic",
        year: 2024,
        trackNumber: 1,
      },
      {
        title: "Second Track",
        artist: "Set Artist",
        album: "Imported Set",
        genre: "Electronic",
        year: 2024,
        trackNumber: 2,
      },
    ]);
    expect(harness.queuedTracks).toEqual([
      {
        fileId: "track-1",
        title: "First Track",
        downloadRequest: {
          sourceUrl: "https://soundcloud.com/artist/first-track",
          audioBitrate: "320",
        },
      },
      {
        fileId: "track-2",
        title: "Second Track",
        downloadRequest: {
          sourceUrl: "https://soundcloud.com/artist/second-track",
          audioBitrate: "320",
        },
      },
    ]);
    expect(harness.events).toEqual(["cover:https://img.example/cover.jpg"]);

    harness.markDownloaded("track-1");
    harness.coverRequest.resolve(cover);
    await settle();

    expect(harness.albums[0].cover).toEqual(cover);
    expect(harness.files.map((file) => file.metadata?.picture)).toEqual([cover, cover]);
    expect(harness.files.map((file) => file.hasBufferedChanges)).toEqual([true, true]);
    expect(harness.updateTagsCalls).toEqual(["track-1"]);
  });

  it("keeps SoundCloud playlist cover off track metadata even when setting is enabled", async () => {
    const harness = createHarness();

    harness.start(soundCloudSet({ isAlbum: false }));
    harness.markDownloaded("track-1");
    harness.coverRequest.resolve(cover);
    await settle();

    expect(harness.albums[0].cover).toEqual(cover);
    expect(harness.files.map((file) => file.metadata?.picture)).toEqual([[], []]);
    expect(harness.updateTagsCalls).toEqual([]);
  });

  it("keeps SoundCloud album cover off track metadata when the setting is disabled", async () => {
    const harness = createHarness({
      ...defaultSettings,
      applySoundCloudAlbumCoverToTracks: false,
    });

    harness.start(soundCloudSet());
    harness.markDownloaded("track-1");
    harness.coverRequest.resolve(cover);
    await settle();

    expect(harness.albums[0].cover).toEqual(cover);
    expect(harness.files.map((file) => file.metadata?.picture)).toEqual([[], []]);
    expect(harness.updateTagsCalls).toEqual([]);
  });
});
