import { useState } from "react";
import { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AppSettings, AudioMetadata, TagiumFile } from "./types";

const toastMocks = vi.hoisted(() => {
  const toast = vi.fn();
  return { toast: Object.assign(toast, { success: vi.fn() }) };
});

vi.mock("sonner", () => ({ toast: toastMocks.toast }));

import { renderHook } from "./hookTestHarness";
import { useAudioWorkspace } from "./useAudioWorkspace";
import { useLibraryStore } from "./useLibraryStore";
import { useTrackEditorSession } from "./useTrackEditorSession";

const initialSettings: AppSettings = {
  mode: "light",
  accentA: "#114cbf",
  accentB: "#e93f2d",
  darkenAccentsInDarkMode: true,
  wordmarkFont: "archivo-black",
  syncTrackNumbers: false,
  syncFilenames: false,
  audioBitrate: "320",
  applySoundCloudAlbumCoverToTracks: false,
};
const metadata = (title: string): AudioMetadata => ({
  filename: title.toLowerCase().replaceAll(" ", "-"),
  title,
  artist: "Artist",
  album: "",
  year: null,
  genre: "",
  duration: 120,
  bitrate: 320,
  sampleRate: 44_100,
  picture: [],
  trackNumber: null,
});
const readyFile = (id: string, title: string): TagiumFile => {
  const file = new File([id], `${id}.mp3`);
  return {
    id,
    filename: file.name,
    file,
    originalFile: file,
    status: "saved",
    downloadStatus: "ready",
    metadata: metadata(title),
  };
};
const keyboardEvent = (key: string, ctrlKey = false) => {
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperties(event, {
    key: { value: key },
    ctrlKey: { value: ctrlKey },
    metaKey: { value: false },
  });
  return event;
};

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("audio workspace", () => {
  it("composes child-facing selection, dialogs, settings, cleanup, and keyboard behavior", () => {
    const removeDownloads = vi.fn();
    const hook = renderHook(() => {
      const library = useLibraryStore();
      const [settings, setSettings] = useState(initialSettings);
      const [activeView, setActiveView] = useState<"editor" | "settings">("editor");
      const editor = useTrackEditorSession({ library, settings });
      const workspace = useAudioWorkspace({
        library,
        editor,
        settings,
        setSettings,
        activeView,
        setActiveView,
        removeDownloads,
        busy: false,
      });
      return { library, settings, activeView, workspace };
    }, undefined);
    const first = readyFile("first", "Artist - First (Official Audio)");
    const second = readyFile("second", "Second");
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [first, second],
        looseTrackIds: [first.id, second.id],
        selection: { selectedAlbumId: null, selectedFileId: first.id },
      });
    });

    const cleanupToast = toastMocks.toast.mock.calls.find(
      ([message]) => typeof message === "string" && message.includes("cleaned up"),
    );
    expect(cleanupToast).toBeDefined();
    void act(() => {
      cleanupToast?.[1].action.onClick();
    });
    expect(hook.result.workspace.cleanupDialogProps).toMatchObject({ open: true });
    act(() =>
      hook.result.workspace.cleanupDialogProps.onApply(
        hook.result.workspace.cleanupDialogProps.suggestions,
      ),
    );
    expect(hook.result.library.getSnapshot().files[0].metadata?.title).toBe("First");

    act(() => hook.result.workspace.sidebarProps.onAddAlbum());
    act(() =>
      hook.result.workspace.albumDialogProps.onChange({
        title: "New Album",
        artist: "Artist",
        genre: "Rock",
      }),
    );
    act(() => hook.result.workspace.albumDialogProps.onSave());
    const albumId = hook.result.library.getSnapshot().albums[0].id;
    act(() => hook.result.workspace.sidebarProps.onMoveTrackToAlbum(first.id, albumId, "append"));
    expect(hook.result.library.getSnapshot()).toMatchObject({
      selectedAlbumId: albumId,
      selectedFileId: first.id,
      albums: [{ id: albumId, trackIds: [first.id] }],
    });

    act(() => hook.result.workspace.sidebarProps.onRemoveFile(second.id));
    expect(hook.result.workspace.removalDialogProps).toMatchObject({ open: true, itemCount: 1 });
    act(() => hook.result.workspace.removalDialogProps.onCancel());
    expect(hook.result.workspace.removalDialogProps).toMatchObject({ open: false, itemCount: 1 });
    act(() => hook.result.workspace.sidebarProps.onRemoveFile(second.id));
    act(() => hook.result.workspace.removalDialogProps.onConfirm());
    expect(removeDownloads).toHaveBeenCalledWith([second.id]);
    expect(hook.result.library.getSnapshot().files.map((file) => file.id)).toEqual([first.id]);

    act(() => hook.result.workspace.sidebarProps.onOpenSettings());
    expect(hook.result.activeView).toBe("settings");
    act(() =>
      hook.result.workspace.settingsPageProps.onChange({
        ...hook.result.settings,
        syncFilenames: true,
      }),
    );
    expect(hook.result.settings.syncFilenames).toBe(true);

    act(() => hook.result.workspace.sidebarProps.onClearSelection());
    expect(hook.result.activeView).toBe("editor");
    expect(hook.result.library.getSnapshot()).toMatchObject({
      selectedAlbumId: null,
      selectedFileId: null,
    });

    act(() => {
      window.dispatchEvent(keyboardEvent("a", true));
    });
    expect(hook.result.library.getSnapshot().selectedFileIds).toEqual(new Set([first.id]));
    act(() => {
      window.dispatchEvent(keyboardEvent("Delete"));
    });
    expect(hook.result.workspace.removalDialogProps.open).toBe(true);
    hook.unmount();
  });
});
