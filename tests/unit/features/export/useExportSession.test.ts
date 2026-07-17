import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";

const exportMocks = vi.hoisted(() => ({
  createZipBlob: vi.fn(),
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
  downloadBlob: vi.fn(),
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
  album: "Album",
  year: null,
  genre: "",
  duration: 120,
  bitrate: 320,
  sampleRate: 44_100,
  picture: [],
  trackNumber: null,
};
const settings: AppSettings = {
  syncTrackNumbers: false,
  syncFilenames: false,
  audioBitrate: "320",
  applySoundCloudAlbumCoverToTracks: false,
};

afterEach(() => vi.clearAllMocks());

describe("export session", () => {
  it("keeps the interface busy until a failed export is routed through cleanup", async () => {
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
          editor: { flush: () => library.getSnapshot().files, updateTags },
          settings,
        }),
      undefined,
    );

    let exporting: Promise<void> | undefined;
    act(() => {
      exporting = hook.result.downloadAll();
    });
    await vi.waitFor(() => expect(rejectZip).toBeTypeOf("function"));
    expect(hook.result.exporting).toBe(true);
    rejectZip?.(new Error("zip failed"));
    await act(async () => exporting);

    expect(updateTags).toHaveBeenCalledWith(file, metadata);
    expect(exportMocks.reportFailure).toHaveBeenCalledWith(expect.any(Error), "export");
    expect(hook.result.exporting).toBe(false);
    hook.unmount();
  });
});
