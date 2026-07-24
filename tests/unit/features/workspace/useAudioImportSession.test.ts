import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AppSettings, AudioMetadata } from "@/features/library/types";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";

const backendMocks = vi.hoisted(() => ({ parseUploads: vi.fn() }));

vi.mock("@/features/audio/audioBackend", () => ({
  parseUploads: backendMocks.parseUploads,
  runAudioBackendEffect: (operation: Promise<unknown>) => operation,
}));

import { createAudioUploadSession } from "@/features/import/audioUploadSession";
import { createLibraryState, libraryReducer } from "@/features/library/libraryState";

const metadata: AudioMetadata = {
  filename: "track",
  title: "Track",
  artist: "Artist",
  albumArtist: "Artist",
  album: "",
  year: null,
  genre: "",
  duration: 120,
  bitrate: 320,
  sampleRate: 44_100,
  picture: [],
  trackNumber: null,
  composer: "",
  comment: "",
  discNumber: null,
  bpm: null,
};
const defaultSettings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  syncTrackNumbers: false,
  syncFilenames: false,
  audioBitrate: "320",
  applySoundCloudAlbumCoverToTracks: false,
};

const createLibrary = (): LibraryStore => {
  let snapshot = createLibraryState();
  return {
    get state() {
      return snapshot;
    },
    getSnapshot: () => snapshot,
    dispatch: (action) => {
      snapshot = libraryReducer(snapshot, action);
    },
  };
};

const parsedUpload = (file: File) => ({
  file: {
    id: "track-1",
    filename: file.name,
    file,
    originalFile: file,
    status: "saved" as const,
    downloadStatus: "ready" as const,
    metadata,
  },
  albumSeed: { title: "", artist: "", genre: "" },
});

afterEach(() => vi.clearAllMocks());

describe("audio upload session", () => {
  it("serializes admission so concurrent duplicate uploads are parsed once", async () => {
    const source = new File(["audio"], "track.mp3", { lastModified: 42 });
    backendMocks.parseUploads.mockImplementation(async (files: File[]) => files.map(parsedUpload));
    const library = createLibrary();
    const bufferEditor = vi.fn();
    const session = createAudioUploadSession({
      library,
      getSettings: () => defaultSettings,
      bufferEditor,
      activateEditor: vi.fn(),
      setUploading: vi.fn(),
    });

    await Promise.all([session.upload([source]), session.upload([source])]);

    expect(backendMocks.parseUploads).toHaveBeenCalledTimes(1);
    expect(library.getSnapshot().files).toHaveLength(1);
    expect(bufferEditor).toHaveBeenCalledTimes(2);
  });

  it("reads current settings after an asynchronous parse before committing", async () => {
    const source = new File(["audio"], "source.mp3", { lastModified: 42 });
    let releaseParse: ((uploads: ReturnType<typeof parsedUpload>[]) => void) | undefined;
    backendMocks.parseUploads.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseParse = resolve;
        }),
    );
    const library = createLibrary();
    let settings = defaultSettings;
    const session = createAudioUploadSession({
      library,
      getSettings: () => settings,
      bufferEditor: vi.fn(),
      activateEditor: vi.fn(),
      setUploading: vi.fn(),
    });

    const importing = session.upload([source]);
    await vi.waitFor(() => expect(releaseParse).toBeTypeOf("function"));
    settings = { ...settings, syncFilenames: true };
    releaseParse?.([parsedUpload(source)]);
    await importing;

    expect(library.getSnapshot().files[0].filename).toBe("Track.mp3");
  });
});
