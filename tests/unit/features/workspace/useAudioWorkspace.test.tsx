import { useState } from "react";
import { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";

import { renderHook } from "../../support/hookTestHarness";
import { useAudioWorkspace } from "@/features/workspace/useAudioWorkspace";
import { useLibraryStore } from "@/features/library/useLibraryStore";
import { useTrackEditorSession } from "@/features/editor/useTrackEditorSession";
import { useWorkspaceNavigation } from "@/features/workspace/workspaceNavigation";
import { buttonElementFixture } from "../../../support/domFixtures";

const initialSettings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  syncTrackNumbers: false,
  syncFilenames: false,
  audioBitrate: "320",
  applySoundCloudAlbumCoverToTracks: false,
};
const metadata = (title: string): AudioMetadata => ({
  filename: title.toLowerCase().replaceAll(" ", "-"),
  title,
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
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("audio workspace", () => {
  it("replaces a single's album title when the track moves into an album", () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      const [settings, setSettings] = useState(initialSettings);
      const editor = useTrackEditorSession({ library, settings });
      const navigation = useWorkspaceNavigation({ library, editor });
      const workspace = useAudioWorkspace({
        library,
        editor,
        settings,
        setSettings,
        navigation,
        removeDownloads: vi.fn(),
        busy: false,
      });
      return { library, workspace };
    }, undefined);
    const single = readyFile("single", "Single Title");
    single.status = "pending";
    single.metadata = { ...single.metadata!, album: "Single Title" };
    single.pendingMetadataPatch = { album: "Single Title" };

    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [single],
        albums: [
          {
            id: "album",
            title: "Album Title",
            artist: "Album Artist",
            genre: "Album Genre",
            trackIds: [],
          },
        ],
        looseTrackIds: [single.id],
      });
    });
    act(() => hook.result.workspace.sidebarProps.onMoveTrackToAlbum(single.id, "album", "append"));

    expect(hook.result.library.getSnapshot().files[0]).toMatchObject({
      status: "pending",
      metadata: { album: "Album Title" },
      pendingMetadataPatch: { album: "Album Title" },
    });
    hook.unmount();
  });

  it("confirms album deletion from the sidebar action before removing its tracks", () => {
    const removeDownloads = vi.fn();
    const hook = renderHook(() => {
      const library = useLibraryStore();
      const [settings, setSettings] = useState(initialSettings);
      const editor = useTrackEditorSession({ library, settings });
      const navigation = useWorkspaceNavigation({ library, editor });
      const workspace = useAudioWorkspace({
        library,
        editor,
        settings,
        setSettings,
        navigation,
        removeDownloads,
        busy: false,
      });
      return { library, workspace };
    }, undefined);
    const track = readyFile("track", "Track");
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [track],
        looseTrackIds: [track.id],
      });
    });
    act(() => hook.result.workspace.sidebarProps.onAddAlbum());
    act(() =>
      hook.result.workspace.albumDialogProps.onChange({
        title: "Album to delete",
        artist: "Artist",
        genre: "Rock",
      }),
    );
    act(() => hook.result.workspace.albumDialogProps.onSave());
    const albumId = hook.result.library.getSnapshot().albums[0].id;
    act(() => hook.result.workspace.sidebarProps.onMoveTrackToAlbum(track.id, albumId, "append"));
    const returnFocusTarget = buttonElementFixture(vi.fn());

    act(() => hook.result.workspace.sidebarProps.onDeleteAlbum(albumId, returnFocusTarget));
    expect(hook.result.workspace.albumDeletionDialogProps).toMatchObject({
      kind: "delete-album",
      open: true,
      albumTitle: "Album to delete",
      trackCount: 1,
      returnFocusTarget,
    });
    act(() => hook.result.workspace.albumDeletionDialogProps.onCancel());
    expect(hook.result.workspace.albumDeletionDialogProps.open).toBe(false);
    expect(hook.result.library.getSnapshot().albums).toHaveLength(1);

    act(() => hook.result.workspace.sidebarProps.onDeleteAlbum(albumId, returnFocusTarget));
    act(() => hook.result.workspace.albumDeletionDialogProps.onConfirm());
    expect(removeDownloads).toHaveBeenCalledWith([track.id]);
    expect(hook.result.library.getSnapshot()).toMatchObject({
      albums: [],
      files: [],
      looseTrackIds: [],
    });
    hook.unmount();
  });
});
