import { useState } from "react";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useWorkspaceSettings } from "@/features/settings/useWorkspaceSettings";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";
import { useLibraryStore } from "@/features/library/useLibraryStore";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import { renderHook } from "../../support/hookTestHarness";

const metadata: AudioMetadata = {
  filename: "track",
  title: "Track",
  artist: "Artist",
  albumArtist: "Custom Album Artist",
  album: "Album",
  year: null,
  genre: "",
  duration: 1,
  bitrate: 128_000,
  sampleRate: 44_100,
  picture: [],
  trackNumber: 9,
  composer: "",
  comment: "",
  discNumber: null,
  bpm: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("workspace settings", () => {
  it("persists policy changes without rewriting current library metadata", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: vi.fn(),
    });
    const file: TagiumFile = {
      id: "track",
      filename: "track.mp3",
      status: "saved",
      downloadStatus: "ready",
      metadata,
    };
    const hook = renderHook(() => {
      const library = useLibraryStore();
      const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
      const controls = useWorkspaceSettings({
        library,
        editor: { isCoverProcessing: false },
        settings,
        setSettings,
        setActiveView: vi.fn(),
      });
      return { library, settings, controls };
    }, undefined);
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file],
        albums: [
          {
            id: "album",
            title: "Album",
            artist: "Album Artist",
            genre: "",
            trackIds: [file.id],
          },
        ],
      });
    });
    const before = hook.result.library.getSnapshot().files[0];

    act(() => {
      hook.result.controls.onChange({
        ...hook.result.settings,
        syncTrackNumbers: false,
        metadataLinks: {
          ...hook.result.settings.metadataLinks,
          albumArtist: false,
        },
      });
    });

    expect(hook.result.library.getSnapshot().files[0]).toBe(before);
    expect(hook.result.library.getSnapshot().files[0]).toMatchObject({
      status: "saved",
      metadata: {
        albumArtist: "Custom Album Artist",
        trackNumber: 9,
      },
    });
    expect(hook.result.library.getSnapshot().files[0]?.pendingMetadataPatch).toBeUndefined();
    hook.unmount();
  });
});
