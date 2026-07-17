import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";

const exportMocks = vi.hoisted(() => ({
  createZipBlob: vi.fn(),
  downloadBlob: vi.fn(),
  reportFailure: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/analytics", () => ({ analytics: { capture: exportMocks.capture } }));
vi.mock("@/features/workspace/systemFailure", () => ({
  reportSystemFailure: exportMocks.reportFailure,
}));
vi.mock("@/features/export/downloadLibrary", () => ({
  allTracksReadyForDownload: () => true,
  createLibraryDownloadFilename: () => "tagium.zip",
  createZipBlob: exportMocks.createZipBlob,
  downloadBlob: exportMocks.downloadBlob,
  getLibraryDownloadEntries: () => [{ path: "track.mp3", file: new File([], "track.mp3") }],
  isTrackReadyForDownload: () => true,
}));

import { renderHook } from "../../support/hookTestHarness";
import { createLibraryState, libraryReducer } from "@/features/library/libraryState";
import { useExportSession } from "@/features/export/useExportSession";

const metadata: AudioMetadata = {
  filename: "track",
  title: "Track",
  artist: "Artist",
  albumArtist: "Custom Album Artist",
  album: "Album",
  year: null,
  genre: "",
  duration: 120,
  bitrate: 320,
  sampleRate: 44_100,
  picture: [],
  trackNumber: null,
  discNumber: null,
  composer: "",
  bpm: null,
  comment: "",
};
const settings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  syncTrackNumbers: false,
  syncFilenames: false,
  audioBitrate: "320",
  applySoundCloudAlbumCoverToTracks: false,
  advancedMetadata: true,
  metadataLinks: { ...DEFAULT_APP_SETTINGS.metadataLinks, albumArtist: false },
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("export session", () => {
  const createHarness = (initialSettings = settings) => {
    const file: TagiumFile = {
      id: "track-1",
      filename: "track.mp3",
      file: new File(["audio"], "track.mp3"),
      originalFile: new File(["audio"], "track.mp3"),
      status: "saved",
      downloadStatus: "ready",
      metadata,
    };
    let snapshot = libraryReducer(createLibraryState(), {
      type: "content-replaced",
      files: [file],
      looseTrackIds: [file.id],
      selection: { selectedFileId: file.id, selectedAlbumId: null },
    });
    const library: LibraryStore = {
      get state() {
        return snapshot;
      },
      getSnapshot: () => snapshot,
      dispatch: (action) => {
        snapshot = libraryReducer(snapshot, action);
      },
    };
    const updateTags = vi.fn(async () => undefined);
    const flush = vi.fn(() => library.getSnapshot().files);
    const projectFiles = vi.fn(() => library.getSnapshot().files);
    const hook = renderHook(
      (currentSettings: AppSettings) =>
        useExportSession({
          library,
          editor: { projectFiles, flush, updateTags },
          settings: currentSettings,
        }),
      initialSettings,
    );
    return { file, hook, library, updateTags, flush, projectFiles };
  };

  it("does nothing before confirmation and cancel has no side effects", () => {
    const { hook, updateTags, flush } = createHarness();

    act(() => hook.result.downloadAll());
    expect(hook.result.confirmation?.trackCount).toBe(1);
    expect(exportMocks.capture).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
    expect(updateTags).not.toHaveBeenCalled();
    expect(exportMocks.createZipBlob).not.toHaveBeenCalled();
    expect(exportMocks.downloadBlob).not.toHaveBeenCalled();

    act(() => hook.result.cancelConfirmation());
    expect(hook.result.confirmation).toBeNull();
    expect(exportMocks.capture).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("restores focus to the control that opened confirmation", () => {
    const trigger = { focus: vi.fn(), isConnected: true };
    vi.stubGlobal("document", { activeElement: trigger });
    const { hook } = createHarness();

    act(() => hook.result.downloadAll());
    act(() => hook.result.cancelConfirmation());
    act(() => hook.result.restoreConfirmationFocus());

    expect(trigger.focus).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it("starts analytics and the export pipeline only after one confirmation", async () => {
    exportMocks.createZipBlob.mockResolvedValue(new Blob(["zip"]));
    const { hook, updateTags, flush } = createHarness();

    act(() => hook.result.downloadAll());
    await act(async () => {
      await Promise.all([hook.result.confirmDownload(), hook.result.confirmDownload()]);
    });

    expect(exportMocks.capture).toHaveBeenNthCalledWith(1, {
      type: "export_started",
      exportKind: "library",
      trackCount: 1,
      albumCount: 0,
    });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(updateTags).toHaveBeenCalledTimes(1);
    expect(exportMocks.createZipBlob).toHaveBeenCalledTimes(1);
    expect(exportMocks.downloadBlob).toHaveBeenCalledTimes(1);
    expect(hook.result.confirmation).toBeNull();
    hook.unmount();
  });

  it("confirms an album export with album-scoped analytics", async () => {
    exportMocks.createZipBlob.mockResolvedValue(new Blob(["zip"]));
    const { hook, library, flush } = createHarness();
    act(() =>
      library.dispatch({
        type: "content-replaced",
        albums: [
          {
            id: "album-1",
            title: "Album",
            artist: "Artist",
            genre: "",
            trackIds: ["track-1"],
          },
        ],
        looseTrackIds: [],
      }),
    );

    act(() => hook.result.downloadAlbum("album-1"));
    expect(hook.result.confirmation?.groups[0]?.title).toBe("Album");
    expect(exportMocks.capture).not.toHaveBeenCalled();
    await act(async () => hook.result.confirmDownload());

    expect(exportMocks.capture).toHaveBeenNthCalledWith(1, {
      type: "export_started",
      exportKind: "album",
      trackCount: 1,
      albumCount: 1,
    });
    expect(flush).toHaveBeenCalledWith(["track-1"]);
    expect(exportMocks.downloadBlob).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it("keeps a single-track download immediate", async () => {
    const { hook, updateTags } = createHarness();

    await act(async () => {
      await hook.result.downloadTrack(metadata);
    });

    expect(hook.result.confirmation).toBeNull();
    expect(updateTags).toHaveBeenCalledTimes(1);
    expect(exportMocks.downloadBlob).toHaveBeenCalledTimes(1);
    expect(exportMocks.capture).toHaveBeenNthCalledWith(1, {
      type: "export_started",
      exportKind: "track",
      trackCount: 1,
    });
    hook.unmount();
  });

  it("keeps a stale confirmation open when its track becomes unready", async () => {
    const { hook, library } = createHarness();
    act(() => hook.result.downloadAll());
    const current = library.getSnapshot().files[0];
    act(() =>
      library.dispatch({
        type: "content-replaced",
        files: current ? [{ ...current, file: undefined }] : [],
      }),
    );

    await act(async () => hook.result.confirmDownload());

    expect(hook.result.confirmation).not.toBeNull();
    expect(hook.result.confirmationStatus).toBe("unavailable");
    expect(exportMocks.capture).not.toHaveBeenCalled();
    expect(exportMocks.createZipBlob).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("requires review again when non-rendered metadata changes", async () => {
    exportMocks.createZipBlob.mockResolvedValue(new Blob(["zip"]));
    const { hook, library } = createHarness();
    act(() => hook.result.downloadAll());
    const current = library.getSnapshot().files[0];
    if (!current?.metadata) throw new Error("test track missing metadata");
    const changedMetadata = { ...current.metadata, genre: "changed" };
    act(() =>
      library.dispatch({
        type: "content-replaced",
        files: [{ ...current, metadata: changedMetadata }],
      }),
    );

    await act(async () => hook.result.confirmDownload());
    expect(hook.result.confirmationStatus).toBe("changed");
    expect(exportMocks.capture).not.toHaveBeenCalled();

    await act(async () => hook.result.confirmDownload());
    expect(exportMocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({ type: "export_started", exportKind: "library" }),
    );
    hook.unmount();
  });

  it("requires review again when export settings change", async () => {
    const { hook } = createHarness();
    act(() => hook.result.downloadAll());
    hook.rerender({ ...settings, syncFilenames: true });

    await act(async () => hook.result.confirmDownload());

    expect(hook.result.confirmationStatus).toBe("changed");
    expect(exportMocks.capture).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("fingerprints unsaved editor values without flushing them before confirmation", async () => {
    const { hook, library, projectFiles, flush } = createHarness();
    act(() => hook.result.downloadAll());
    const current = library.getSnapshot().files[0];
    if (!current?.metadata) throw new Error("test track missing metadata");
    projectFiles.mockReturnValue([
      { ...current, metadata: { ...current.metadata, artist: "Unsaved artist" } },
    ]);

    await act(async () => hook.result.confirmDownload());

    expect(hook.result.confirmationStatus).toBe("changed");
    expect(flush).not.toHaveBeenCalled();
    expect(exportMocks.capture).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("keeps the interface busy until a failed export is routed through cleanup", async () => {
    const file: TagiumFile = {
      id: "track-1",
      format: "mp3",
      filename: "track.mp3",
      file: new File(["audio"], "track.mp3"),
      originalFile: new File(["audio"], "track.mp3"),
      status: "saved",
      downloadStatus: "ready",
      metadata,
    };
    let snapshot = libraryReducer(createLibraryState(), {
      type: "content-replaced",
      files: [file],
      albums: [
        {
          id: "album-1",
          title: "Album",
          artist: "Album Artist",
          genre: "",
          trackIds: [file.id],
        },
      ],
    });
    const library: LibraryStore = {
      get state() {
        return snapshot;
      },
      getSnapshot: () => snapshot,
      dispatch: (action) => {
        snapshot = libraryReducer(snapshot, action);
      },
    };
    const updateTags = vi.fn(async () => undefined);
    let rejectZip: ((error: Error) => void) | undefined;
    exportMocks.createZipBlob.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectZip = reject;
        }),
    );
    const hook = renderHook(
      () =>
        useExportSession({
          library,
          editor: {
            projectFiles: () => library.getSnapshot().files,
            flush: () => library.getSnapshot().files,
            updateTags,
          },
          settings,
        }),
      undefined,
    );

    let exporting: Promise<void> | undefined;
    act(() => {
      hook.result.downloadAll();
    });
    act(() => {
      exporting = hook.result.confirmDownload();
    });
    await vi.waitFor(() => expect(rejectZip).toBeTypeOf("function"));
    expect(hook.result.exporting).toBe(true);
    rejectZip?.(new Error("zip failed"));
    await act(async () => exporting);

    expect(updateTags).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ albumArtist: "Custom Album Artist" }),
    );
    expect(exportMocks.reportFailure).toHaveBeenCalledWith(expect.any(Error), "export");
    expect(hook.result.exporting).toBe(false);
    hook.unmount();
  });
});
