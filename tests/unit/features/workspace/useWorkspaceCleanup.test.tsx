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
  syncTrackNumbers: false,
  syncFilenames: true,
  audioBitrate: "320",
  applySoundCloudAlbumCoverToTracks: false,
};

const metadata = (title: string): AudioMetadata => ({
  filename: title,
  title,
  artist: "Burial",
  albumArtist: "Burial",
  album: "Untrue",
  year: 2007,
  genre: "Electronic",
  duration: 240,
  bitrate: 320,
  sampleRate: 44_100,
  picture: [],
  trackNumber: 1,
  discNumber: null,
  composer: "",
  bpm: null,
  comment: "",
});

const file = (id: string, title: string): TagiumFile => ({
  id,
  format: "mp3",
  status: "saved",
  downloadStatus: "ready",
  filename: `${title}.mp3`,
  metadata: metadata(title),
});

const album = (id: string, title: string, trackId: string): AlbumGroup => ({
  id,
  title,
  artist: "Burial",
  genre: "Electronic",
  trackIds: [trackId],
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("workspace title cleanup", () => {
  it("keeps warnings and an open album review intact while the workspace becomes busy", () => {
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
      { busy: false },
    );

    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file("track", "Burial - Archangel (Official Audio)")],
        albums: [album("album", "Untrue", "track")],
      });
    });
    act(() => hook.result.cleanup.onReviewAlbum("album"));
    expect(hook.result.cleanup.dialogProps.suggestions).toHaveLength(1);

    hook.rerender({ busy: true });

    expect(hook.result.cleanup.albumIdsWithSuggestions).toContain("album");
    expect(hook.result.cleanup.dialogProps).toMatchObject({ open: true });
    expect(hook.result.cleanup.dialogProps.suggestions.map(({ trackId }) => trackId)).toEqual([
      "track",
    ]);
    hook.unmount();
  });

  it("keeps album suggestions isolated and available after dismissing the dialog", () => {
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
        albums: [album("first", "Untrue", "one"), album("second", "Untrue", "two")],
      });
    });

    expect(hook.result.cleanup.albumIdsWithSuggestions).toEqual(new Set(["first", "second"]));

    act(() => hook.result.cleanup.onReviewAlbum("first"));
    expect(hook.result.cleanup.dialogProps).toMatchObject({ open: true });
    expect(hook.result.cleanup.dialogProps.suggestions.map(({ trackId }) => trackId)).toEqual([
      "one",
    ]);

    act(() => hook.result.cleanup.dialogProps.onOpenChange(false));
    expect(hook.result.cleanup.albumIdsWithSuggestions).toContain("first");
    act(() => hook.result.cleanup.onReviewAlbum("first"));
    expect(hook.result.cleanup.dialogProps.suggestions).toHaveLength(1);
    hook.unmount();
  });

  it("removes an applied warning, restores it on undo, and reappears after a later title edit", () => {
    const reset = vi.fn();
    const hook = renderHook(() => {
      const library = useLibraryStore();
      const cleanup = useWorkspaceCleanup({
        library,
        editor: { form: { reset } },
        settings,
        busy: false,
      });
      return { library, cleanup };
    }, undefined);
    const group = album("album", "Untrue", "track");

    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file("track", "Burial - Archangel (Official Audio)")],
        albums: [group],
        selection: { selectedAlbumId: "album", selectedFileId: "track" },
      });
    });
    act(() => hook.result.cleanup.onReviewAlbum("album"));
    act(() => hook.result.cleanup.dialogProps.onApply(hook.result.cleanup.dialogProps.suggestions));

    expect(hook.result.library.getSnapshot().files[0].metadata?.title).toBe("Archangel");
    expect(hook.result.cleanup.albumIdsWithSuggestions).not.toContain("album");

    const undo = toastMocks.toast.success.mock.calls.at(-1)?.[1].action.onClick;
    void act(() => undo());
    expect(hook.result.cleanup.albumIdsWithSuggestions).toContain("album");

    act(() => hook.result.cleanup.onReviewAlbum("album"));
    act(() => hook.result.cleanup.dialogProps.onApply(hook.result.cleanup.dialogProps.suggestions));
    expect(hook.result.cleanup.albumIdsWithSuggestions).not.toContain("album");

    act(() => {
      const current = hook.result.library.getSnapshot().files[0];
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [
          {
            ...current,
            metadata: { ...current.metadata!, title: "Burial - Archangel (Official Video)" },
          },
        ],
      });
    });
    expect(hook.result.cleanup.albumIdsWithSuggestions).toContain("album");
    hook.unmount();
  });
});
