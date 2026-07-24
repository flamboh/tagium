import { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AlbumGroup, AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";

const toastMocks = vi.hoisted(() => {
  const toast = vi.fn();
  return { toast: Object.assign(toast, { success: vi.fn() }) };
});

vi.mock("sonner", () => ({ toast: toastMocks.toast }));

import { renderHook } from "../../support/hookTestHarness";
import { useLibraryStore } from "@/features/library/useLibraryStore";
import { useWorkspaceCleanup } from "@/features/workspace/useWorkspaceCleanup";

const settings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  syncFilenames: true,
};

const metadata = (title: string): AudioMetadata => ({
  filename: title,
  title,
  artist: "Burial",
  album: "Untrue",
  year: 2007,
  genre: "Electronic",
  duration: 240,
  bitrate: 320,
  sampleRate: 44_100,
  picture: [],
  trackNumber: 1,
});

const file = (id: string, title: string): TagiumFile => ({
  id,
  status: "saved",
  downloadStatus: "ready",
  filename: `${title}.mp3`,
  metadata: metadata(title),
});

const album = (trackIds: string[]): AlbumGroup => ({
  id: "album",
  title: "Untrue",
  artist: "Burial",
  genre: "Electronic",
  trackIds,
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("workspace title cleanup", () => {
  it("keeps manual album cleanup live and available while busy suppresses proactive offers", () => {
    const hook = renderHook(
      ({ busy }: { busy: boolean }) => {
        const library = useLibraryStore();
        const cleanup = useWorkspaceCleanup({
          library,
          editor: { form: { reset: vi.fn() } },
          settings,
          busy,
        });
        return { library, cleanup };
      },
      { busy: true },
    );

    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file("track", "Burial - Archangel (Official Audio)")],
        albums: [album(["track"])],
      });
    });

    expect(hook.result.cleanup.cleanupSuggestionCountByAlbumId.get("album")).toBe(1);
    expect(toastMocks.toast).not.toHaveBeenCalled();

    const focusTarget = { focus: vi.fn() } as unknown as HTMLButtonElement;
    act(() => hook.result.cleanup.onReviewAlbum("album", focusTarget));
    expect(hook.result.cleanup.dialogProps).toMatchObject({
      open: true,
      albumTitle: "Untrue",
      returnFocusTarget: focusTarget,
    });
    expect(hook.result.cleanup.dialogProps.suggestions).toHaveLength(1);

    act(() => {
      const current = hook.result.library.getSnapshot().files[0];
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [{ ...current, metadata: { ...current.metadata!, title: "Archangel" } }],
      });
    });
    expect(hook.result.cleanup.dialogProps.suggestions).toEqual([]);
    expect(hook.result.cleanup.cleanupSuggestionCountByAlbumId.has("album")).toBe(false);
    hook.unmount();
  });

  it("starts a fresh selection session on each open and keeps toast entry on normal focus", () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      const cleanup = useWorkspaceCleanup({
        library,
        editor: { form: { reset: vi.fn() } },
        settings,
        busy: false,
      });
      return { library, cleanup };
    }, undefined);

    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file("track", "Burial - Archangel (Official Audio)")],
        albums: [album(["track"])],
      });
    });
    const toastAction = toastMocks.toast.mock.calls.at(-1)?.[1].action.onClick;
    void act(() => toastAction());
    const toastSession = hook.result.cleanup.dialogProps.selectionSessionKey;
    expect(hook.result.cleanup.dialogProps.returnFocusTarget).toBeNull();

    act(() => hook.result.cleanup.dialogProps.onOpenChange(false));
    act(() => hook.result.cleanup.onReviewAlbum("album", null));
    expect(hook.result.cleanup.dialogProps.selectionSessionKey).toBe(toastSession + 1);
    hook.unmount();
  });

  it("intersects a stale selection with current album suggestions before applying", () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      const cleanup = useWorkspaceCleanup({
        library,
        editor: { form: { reset: vi.fn() } },
        settings,
        busy: false,
      });
      return { library, cleanup };
    }, undefined);

    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [
          file("one", "Burial - Archangel (Official Audio)"),
          file("two", "Burial - Near Dark (Official Audio)"),
        ],
        albums: [album(["one", "two"])],
      });
    });
    act(() => hook.result.cleanup.onReviewAlbum("album", null));
    const staleSelection = hook.result.cleanup.dialogProps.suggestions;
    act(() => {
      const [one, two] = hook.result.library.getSnapshot().files;
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [{ ...one, metadata: { ...one.metadata!, title: "Archangel" } }, two],
      });
    });
    act(() => hook.result.cleanup.dialogProps.onApply(staleSelection));

    expect(hook.result.library.getSnapshot().files.map((item) => item.metadata?.title)).toEqual([
      "Archangel",
      "Near Dark",
    ]);
    expect(toastMocks.toast.success).toHaveBeenLastCalledWith(
      "cleaned up 1 track",
      expect.any(Object),
    );
    hook.unmount();
  });
});
