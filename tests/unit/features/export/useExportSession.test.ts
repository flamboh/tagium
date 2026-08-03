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
vi.mock("@/features/export/downloadLibrary", () => {
  const ready = (file: TagiumFile) =>
    Boolean(file.file && file.metadata && file.metadata.filename.trim());
  return {
    allTracksReadyForDownload: (files: TagiumFile[]) => files.every(ready),
    createLibraryDownloadFilename: () => "tagium.zip",
    createZipBlob: exportMocks.createZipBlob,
    downloadBlob: exportMocks.downloadBlob,
    getAlbumCoverDownload: () => null,
    getLibraryDownloadEntries: ({ files }: { files: TagiumFile[] }) =>
      files.filter(ready).map((file) => ({ path: file.filename, file: file.file as File })),
    isTrackReadyForDownload: ready,
  };
});

import { renderHook } from "../../support/hookTestHarness";
import { createLibraryState, libraryReducer } from "@/features/library/libraryState";
import { useExportSession } from "@/features/export/useExportSession";

const metadata: AudioMetadata = {
  filename: "track",
  title: "Track",
  artist: "Artist",
  albumArtist: "Artist",
  album: "Album",
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
const settings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  syncTrackNumbers: false,
  syncFilenames: false,
  audioBitrate: "320",
  applySoundCloudAlbumCoverToTracks: false,
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  exportMocks.createZipBlob.mockResolvedValue(new Blob(["zip"]));
});

describe("export session", () => {
  const createHarness = (initialSettings = settings) => {
    const file: TagiumFile = {
      id: "track-1",
      format: { kind: "mp3", extension: "mp3", mime: "audio/mpeg" },
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

  it("keeps requesting and canceling confirmation completely side-effect free", () => {
    const { hook, updateTags, flush, library } = createHarness();
    const dispatch = vi.spyOn(library, "dispatch");

    act(() => hook.result.downloadAll());
    expect(hook.result.confirmation?.trackCount).toBe(1);
    expect(exportMocks.capture).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
    expect(updateTags).not.toHaveBeenCalled();
    expect(exportMocks.createZipBlob).not.toHaveBeenCalled();
    expect(exportMocks.downloadBlob).not.toHaveBeenCalled();

    act(() => hook.result.cancelConfirmation());
    expect(hook.result.confirmation).toBeNull();
    expect(exportMocks.capture).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("restores the initiating control or a safe fallback", () => {
    const trigger: {
      focus: ReturnType<typeof vi.fn>;
      isConnected: boolean;
      checkVisibility?: () => boolean;
    } = { focus: vi.fn(), isConnected: true };
    const fallback = {
      focus: vi.fn(),
      checkVisibility: () => true,
    };
    vi.stubGlobal("document", {
      activeElement: trigger,
      querySelectorAll: vi.fn(() => [fallback]),
    });
    const { hook } = createHarness();

    act(() => hook.result.downloadAll());
    act(() => hook.result.cancelConfirmation());
    act(() => hook.result.restoreConfirmationFocus());
    expect(trigger.focus).toHaveBeenCalledOnce();

    trigger.isConnected = false;
    act(() => hook.result.downloadAll());
    act(() => hook.result.cancelConfirmation());
    act(() => hook.result.restoreConfirmationFocus());
    expect(fallback.focus).toHaveBeenCalledOnce();

    trigger.isConnected = true;
    trigger.checkVisibility = () => false;
    act(() => hook.result.downloadAll());
    act(() => hook.result.cancelConfirmation());
    act(() => hook.result.restoreConfirmationFocus());
    expect(fallback.focus).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it("starts analytics and the ZIP pipeline only after confirmation and guards duplicate submit", async () => {
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

  it("confirms album ZIPs while leaving single-track downloads immediate", async () => {
    const { hook, library, flush, updateTags } = createHarness();
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
    await act(async () => hook.result.confirmDownload());
    expect(flush).toHaveBeenCalledWith(["track-1"]);
    expect(exportMocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({ type: "export_started", exportKind: "album", albumCount: 1 }),
    );

    await act(async () => {
      await hook.result.downloadTrack(metadata);
    });
    expect(updateTags).toHaveBeenCalledTimes(2);
    expect(exportMocks.capture).toHaveBeenCalledWith({
      type: "export_started",
      exportKind: "track",
      trackCount: 1,
    });
    hook.unmount();
  });

  it("refreshes changed plans for unsaved values and settings and requires a second confirm", async () => {
    const { hook, library, projectFiles, flush } = createHarness();
    act(() => hook.result.downloadAll());
    const current = library.getSnapshot().files[0]!;
    const projectedFiles = [
      { ...current, metadata: { ...current.metadata!, artist: "Unsaved artist" } },
    ];
    projectFiles.mockReturnValue(projectedFiles);
    flush.mockReturnValue(projectedFiles);

    await act(async () => hook.result.confirmDownload());
    expect(hook.result.confirmationStatus).toBe("changed");
    expect(flush).not.toHaveBeenCalled();
    expect(exportMocks.capture).not.toHaveBeenCalled();

    await act(async () => hook.result.confirmDownload());
    expect(exportMocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({ type: "export_started", exportKind: "library" }),
    );

    act(() => hook.result.downloadAll());
    hook.rerender({ ...settings, syncFilenames: true });
    await act(async () => hook.result.confirmDownload());
    expect(hook.result.confirmationStatus).toBe("changed");
    hook.unmount();
  });

  it("keeps the stale plan open when the target is unavailable before or during execution", async () => {
    const { hook, library, updateTags } = createHarness();
    act(() => hook.result.downloadAll());
    const current = library.getSnapshot().files[0]!;
    act(() =>
      library.dispatch({
        type: "content-replaced",
        files: [{ ...current, file: undefined }],
      }),
    );
    await act(async () => hook.result.confirmDownload());
    expect(hook.result.confirmationStatus).toBe("unavailable");
    expect(hook.result.confirmation).not.toBeNull();
    expect(exportMocks.capture).not.toHaveBeenCalled();

    act(() => library.dispatch({ type: "content-replaced", files: [current] }));
    act(() => hook.result.cancelConfirmation());
    act(() => hook.result.downloadAll());
    updateTags.mockImplementationOnce(async () => {
      library.dispatch({
        type: "content-replaced",
        files: [{ ...library.getSnapshot().files[0]!, file: undefined }],
      });
    });
    await act(async () => hook.result.confirmDownload());
    expect(hook.result.confirmationStatus).toBe("unavailable");
    expect(exportMocks.createZipBlob).not.toHaveBeenCalled();
    expect(exportMocks.downloadBlob).not.toHaveBeenCalled();
    expect(hook.result.exporting).toBe(false);
    hook.unmount();
  });

  it("rejects album and artwork drift that occurs while metadata is being written", async () => {
    const { hook, library, updateTags } = createHarness();
    act(() =>
      library.dispatch({
        type: "content-replaced",
        albums: [
          {
            id: "album-1",
            title: "Original album",
            artist: "Artist",
            genre: "",
            trackIds: ["track-1"],
          },
        ],
        looseTrackIds: [],
      }),
    );
    updateTags.mockImplementationOnce(async () => {
      const snapshot = library.getSnapshot();
      library.dispatch({
        type: "content-replaced",
        albums: snapshot.albums.map((album) => ({
          ...album,
          title: "Changed during write",
          cover: [
            {
              format: "image/jpeg",
              type: 3,
              description: "changed",
              data: new Uint8Array([9, 8, 7]),
            },
          ],
        })),
      });
    });

    act(() => hook.result.downloadAlbum("album-1"));
    await act(async () => hook.result.confirmDownload());

    expect(hook.result.confirmationStatus).toBe("unavailable");
    expect(hook.result.confirmation).not.toBeNull();
    expect(exportMocks.createZipBlob).not.toHaveBeenCalled();
    expect(exportMocks.downloadBlob).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("rejects filename, metadata, and relevant-setting drift during updateTags", async () => {
    const { hook, library, updateTags } = createHarness();
    let finishWrite: (() => void) | undefined;
    updateTags.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finishWrite = () => {
            const current = library.getSnapshot().files[0]!;
            library.dispatch({
              type: "content-replaced",
              files: [
                {
                  ...current,
                  filename: "changed.mp3",
                  metadata: { ...current.metadata!, artist: "Changed during write" },
                  file: new File(["rewritten"], "changed.mp3"),
                },
              ],
            });
            resolve(undefined);
          };
        }),
    );

    act(() => hook.result.downloadAll());
    let confirmation!: Promise<void>;
    act(() => {
      confirmation = hook.result.confirmDownload();
    });
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf("function"));
    hook.rerender({ ...settings, syncTrackNumbers: true });
    finishWrite?.();
    await act(async () => confirmation);

    expect(hook.result.confirmationStatus).toBe("unavailable");
    expect(exportMocks.createZipBlob).not.toHaveBeenCalled();
    expect(exportMocks.downloadBlob).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("reports failures, leaves the dialog retryable, and always unlocks the app", async () => {
    exportMocks.createZipBlob.mockRejectedValueOnce(new Error("zip failed"));
    const { hook } = createHarness();
    act(() => hook.result.downloadAll());
    await act(async () => hook.result.confirmDownload());

    expect(exportMocks.reportFailure).toHaveBeenCalledWith(expect.any(Error), "export");
    expect(hook.result.confirmation).not.toBeNull();
    expect(hook.result.exporting).toBe(false);
    hook.unmount();
  });
});
