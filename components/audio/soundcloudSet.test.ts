import { describe, expect, it } from "vite-plus/test";
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
  const hydratedPictures: Array<AudioMetadata["picture"] | undefined> = [];
  const updateTagsCalls: string[] = [];
  const coverRequest = deferred<AudioMetadata["picture"]>();
  const downloads = new Map<string, Deferred<File>>();
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
      downloadCobaltAudio: (request) => {
        events.push(`download:${request.sourceUrl}:${request.audioBitrate}`);
        const download = deferred<File>();
        downloads.set(request.sourceUrl, download);
        return download.promise;
      },
      hydrateDownloadedTrack: async (fileId, downloadedFile) => {
        const currentFile = files.find((file) => file.id === fileId);
        hydratedPictures.push(currentFile?.metadata?.picture);
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
      },
      markDownloadError: () => {},
      updateTags: async (file) => {
        updateTagsCalls.push(file.id);
      },
      warn: () => {},
    });

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
    downloads,
    events,
    get files() {
      return files;
    },
    get hydratedPictures() {
      return hydratedPictures;
    },
    get lastSelectedFileId() {
      return lastSelectedFileId;
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

describe("soundcloud set import", () => {
  it("imports an album through the shipped operation across cover and hydration ordering", async () => {
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
    expect(harness.events).toEqual([
      "cover:https://img.example/cover.jpg",
      "download:https://soundcloud.com/artist/first-track:320",
      "download:https://soundcloud.com/artist/second-track:320",
    ]);

    harness.downloads
      .get("https://soundcloud.com/artist/first-track")
      ?.resolve(new File(["first"], "first.mp3", { type: "audio/mpeg" }));
    await settle();

    expect(harness.hydratedPictures).toEqual([[]]);

    harness.coverRequest.resolve(cover);
    await settle();

    expect(harness.albums[0].cover).toEqual(cover);
    expect(harness.files.map((file) => file.metadata?.picture)).toEqual([cover, cover]);
    expect(harness.files.map((file) => file.hasBufferedChanges)).toEqual([true, true]);
    expect(harness.updateTagsCalls).toEqual(["track-1"]);

    harness.downloads
      .get("https://soundcloud.com/artist/second-track")
      ?.resolve(new File(["second"], "second.mp3", { type: "audio/mpeg" }));
    await settle();

    expect(harness.hydratedPictures).toEqual([[], cover]);
  });

  it("keeps SoundCloud playlist cover off track metadata even when setting is enabled", async () => {
    const harness = createHarness();

    harness.start(soundCloudSet({ isAlbum: false }));
    harness.coverRequest.resolve(cover);
    await settle();

    expect(harness.albums[0].cover).toEqual(cover);
    expect(harness.files.map((file) => file.metadata?.picture)).toEqual([[], []]);
    expect(harness.updateTagsCalls).toEqual([]);

    harness.downloads
      .get("https://soundcloud.com/artist/first-track")
      ?.resolve(new File(["first"], "first.mp3", { type: "audio/mpeg" }));
    await settle();

    expect(harness.hydratedPictures).toEqual([[]]);
  });

  it("keeps SoundCloud album cover off track metadata when the setting is disabled", async () => {
    const harness = createHarness({
      ...defaultSettings,
      applySoundCloudAlbumCoverToTracks: false,
    });

    harness.start(soundCloudSet());
    harness.coverRequest.resolve(cover);
    await settle();

    expect(harness.albums[0].cover).toEqual(cover);
    expect(harness.files.map((file) => file.metadata?.picture)).toEqual([[], []]);
    expect(harness.updateTagsCalls).toEqual([]);
  });
});
