import { Effect } from "effect";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { AppSettings } from "./types";

const mocks = vi.hoisted(() => ({ resolveTrackMetadata: vi.fn() }));

vi.mock("./audioBackend", () => ({
  downloadFromCobalt: () => Effect.never,
  provideAudioBackend: (operation: unknown) => operation,
  parseUploads: vi.fn(),
  runAudioBackendEffect: vi.fn(),
  writeTags: vi.fn(),
}));
vi.mock("./trackMetadata", () => ({ resolveTrackMetadata: mocks.resolveTrackMetadata }));

import { renderHook } from "./hookTestHarness";
import { useAudioImportSession } from "./useAudioImportSession";
import { useLibraryStore } from "./useLibraryStore";
import { useTrackEditorSession } from "./useTrackEditorSession";

const settings = (audioBitrate: AppSettings["audioBitrate"]): AppSettings => ({
  theme: "signal",
  syncTrackNumbers: false,
  syncFilenames: false,
  audioBitrate,
  applySoundCloudAlbumCoverToTracks: false,
});

afterEach(() => vi.clearAllMocks());

describe("audio URL import session", () => {
  it("uses the latest settings and activation callback after asynchronous metadata resolution", async () => {
    let resolveMetadata: ((metadata: { title: string; artist: string }) => void) | undefined;
    mocks.resolveTrackMetadata.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMetadata = resolve;
        }),
    );
    const firstActivation = vi.fn();
    const latestActivation = vi.fn();
    const hook = renderHook(
      ({ currentSettings, activateEditor }) => {
        const library = useLibraryStore();
        const editor = useTrackEditorSession({ library, settings: currentSettings });
        const importing = useAudioImportSession({
          library,
          editor,
          settings: currentSettings,
          activateEditor,
        });
        return { library, importing };
      },
      { currentSettings: settings("320"), activateEditor: firstActivation },
    );

    let importing: Promise<void> | undefined;
    act(() => {
      importing = hook.result.importing.commands.importUrl("https://example.com/latest-track");
    });
    await vi.waitFor(() => expect(resolveMetadata).toBeTypeOf("function"));
    hook.rerender({ currentSettings: settings("128"), activateEditor: latestActivation });
    resolveMetadata?.({ title: "Latest Track", artist: "Artist" });
    await act(async () => importing);

    expect(firstActivation).not.toHaveBeenCalled();
    expect(latestActivation).toHaveBeenCalledOnce();
    expect(hook.result.library.getSnapshot().files[0].downloadRequest?.audioBitrate).toBe("128");
    act(() => hook.result.importing.commands.cancelQueue());
    hook.unmount();
  });
});
