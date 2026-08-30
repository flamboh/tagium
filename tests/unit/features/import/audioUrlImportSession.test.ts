import { Effect } from "effect";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { CobaltAudioDownloadRequest } from "@/features/import/cobaltAudio";
import type { AppSettings, AudioMetadata } from "@/features/library/types";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";
import type { Manifest } from "@/features/share/shareManifest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  downloadFromCobalt: vi.fn((_request: CobaltAudioDownloadRequest) => Effect.never),
  fetchImportedCover: vi.fn(),
  runAudioBackendEffect: vi.fn(),
  resolveTrackMetadata: vi.fn(),
  resolveSoundCloudSet: vi.fn(),
  resolveYouTubePlaylist: vi.fn(),
  writeTags: vi.fn(),
}));

vi.mock("@/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/analytics")>()),
  analytics: { capture: mocks.capture },
}));
vi.mock("@/features/audio/audioBackend", () => ({
  downloadFromCobalt: mocks.downloadFromCobalt,
  provideAudioBackend: <Operation>(operation: Operation) => operation,
  parseUploads: vi.fn(),
  runAudioBackendEffect: mocks.runAudioBackendEffect,
  writeTags: mocks.writeTags,
}));
vi.mock("@/features/import/downloadTrack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/import/downloadTrack")>()),
  fetchImportedCover: mocks.fetchImportedCover,
}));
vi.mock("@/features/import/trackMetadata", () => ({
  resolveTrackMetadata: mocks.resolveTrackMetadata,
}));
vi.mock("@/features/import/soundcloudSet", () => ({
  isSoundCloudSetUrl: (url: string) => url.includes("soundcloud.com") && url.includes("/sets/"),
  resolveSoundCloudSet: mocks.resolveSoundCloudSet,
}));
vi.mock("@/features/import/youtubePlaylist", () => ({
  isYouTubePlaylistUrl: (url: string) => url.includes("youtube.com/playlist"),
  resolveYouTubePlaylist: mocks.resolveYouTubePlaylist,
}));

import { renderHook } from "../../support/hookTestHarness";
import { useAudioImportSession } from "@/features/workspace/useAudioImportSession";
import { useLibraryStore } from "@/features/library/useLibraryStore";
import { useTrackEditorSession } from "@/features/editor/useTrackEditorSession";

const settings = (
  audioBitrate: AppSettings["audioBitrate"],
  audioFormat: AppSettings["audioFormat"] = DEFAULT_APP_SETTINGS.audioFormat,
): AppSettings => ({
  ...DEFAULT_APP_SETTINGS,
  syncTrackNumbers: false,
  syncFilenames: false,
  audioBitrate,
  audioFormat,
  applySoundCloudAlbumCoverToTracks: false,
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("audio URL import session", () => {
  it("imports a shared track as an exact loose track with file-level provenance", async () => {
    const manifest: Manifest = {
      version: 1,
      kind: "track",
      track: {
        sourceUrl: "https://soundcloud.com/artist/shared-track",
        audioBitrate: "128",
        metadata: {
          filename: "shared filename",
          title: "Shared title",
          artist: "Shared artist",
          album: "Metadata-only album",
          genre: "Ambient",
          year: 2024,
          trackNumber: 9,
        },
      },
    };
    const hook = renderHook(() => {
      const library = useLibraryStore();
      const editor = useTrackEditorSession({ library, settings: settings("320") });
      const importing = useAudioImportSession({
        library,
        editor,
        settings: settings("320"),
        activateEditor: vi.fn(),
      });
      return { library, importing };
    }, undefined);

    await act(async () => {
      await hook.result.importing.commands.importSharedContent(manifest, "shared-track-slug");
    });

    const snapshot = hook.result.library.getSnapshot();
    expect(snapshot.albums).toEqual([]);
    expect(snapshot.looseTrackIds).toEqual([snapshot.files[0]?.id]);
    expect(snapshot.selectedAlbumId).toBeNull();
    expect(snapshot.files[0]).toMatchObject({
      filename: "shared filename.mp3",
      sourceManifestSlug: "shared-track-slug",
      metadata: {
        title: "Shared title",
        artist: "Shared artist",
        album: "Metadata-only album",
        year: 2024,
        trackNumber: 9,
      },
      downloadRequest: {
        sourceUrl: "https://soundcloud.com/artist/shared-track",
        audioBitrate: "128",
      },
    });
    act(() => hook.result.importing.commands.cancelQueue());
    hook.unmount();
  });

  it("records accepted and rejected URL processing after resolution", async () => {
    mocks.resolveTrackMetadata.mockResolvedValue({ title: "Linked Single", artist: "Artist" });
    const hook = renderHook(() => {
      const library = useLibraryStore();
      const editor = useTrackEditorSession({ library, settings: settings("320", "best") });
      const importing = useAudioImportSession({
        library,
        editor,
        settings: settings("320", "best"),
        activateEditor: vi.fn(),
      });
      return { library, importing };
    }, undefined);

    await act(async () => {
      await hook.result.importing.commands.importUrl("https://www.youtube.com/watch?v=abcdefghijk");
    });
    expect(hook.result.library.getSnapshot().files[0]).toMatchObject({
      metadata: { title: "Linked Single", album: "Linked Single" },
      pendingMetadataPatch: { album: "Linked Single" },
    });
    expect(mocks.capture).toHaveBeenCalledWith({
      type: "media_link_processed",
      sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      mediaKind: "track",
      linkKind: "canonical",
      normalized: false,
      redirected: false,
      outcome: "accepted",
    });
    expect(mocks.capture).toHaveBeenCalledWith({
      type: "import_started",
      sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      importKind: "single",
      requestedFormat: "best",
    });

    await expect(
      hook.result.importing.commands.importUrl("https://soundcloud.com/discover"),
    ).rejects.toThrow("unsupported url");
    expect(mocks.capture).toHaveBeenCalledWith({
      type: "media_link_processed",
      sourceUrl: "https://soundcloud.com/discover",
      mediaKind: "unsupported",
      linkKind: "canonical",
      normalized: false,
      redirected: false,
      outcome: "rejected",
      failureReason: "unsupported",
    });
    hook.unmount();
  });

  it.each(["success", "failure"] as const)(
    "preserves dirty track metadata when a playlist cover write ends in %s",
    async (outcome) => {
      let resolveCover: ((cover: AudioMetadata["picture"]) => void) | undefined;
      mocks.fetchImportedCover.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCover = resolve;
          }),
      );
      mocks.resolveSoundCloudSet.mockResolvedValue({
        title: "Imported album",
        artist: "Artist",
        genre: "Electronic",
        isAlbum: true,
        coverUrl: "https://example.com/cover.jpg",
        tracks: [
          {
            title: "Track",
            url: "https://soundcloud.com/artist/track",
            trackNumber: 1,
          },
          {
            title: "Second track",
            url: "https://soundcloud.com/artist/second-track",
            trackNumber: 2,
          },
        ],
      });
      const coverSettings = {
        ...settings("320"),
        applySoundCloudAlbumCoverToTracks: true,
      };
      const hook = renderHook(() => {
        const library = useLibraryStore();
        const editor = useTrackEditorSession({ library, settings: coverSettings });
        const importing = useAudioImportSession({
          library,
          editor,
          settings: coverSettings,
          activateEditor: vi.fn(),
        });
        return { editor, importing, library };
      }, undefined);

      await act(async () => {
        await hook.result.importing.commands.importUrl(
          "https://soundcloud.com/artist/sets/imported-album",
        );
      });
      const downloaded = new File(["downloaded"], "track.mp3", { type: "audio/mpeg" });
      act(() => {
        const snapshot = hook.result.library.getSnapshot();
        hook.result.library.dispatch({
          type: "content-replaced",
          files: snapshot.files.map((file, index) =>
            index === 0
              ? {
                  ...file,
                  file: downloaded,
                  originalFile: downloaded,
                  status: "saved",
                  downloadStatus: "ready",
                }
              : file,
          ),
        });
      });
      const comment = hook.result.editor.form.register("comment");
      act(() => {
        void comment.onChange({
          target: { name: "comment", value: "keep this edit" },
          type: "change",
        });
      });
      const cover: AudioMetadata["picture"] = [
        {
          format: "image/jpeg",
          type: 3,
          description: "playlist cover",
          data: new Uint8Array([1, 2, 3]),
        },
      ];
      const written = new File(["written"], "track.mp3", { type: "audio/mpeg" });
      let resolveWrite: ((file: File) => void) | undefined;
      let rejectWrite: ((error: Error) => void) | undefined;
      mocks.writeTags.mockReturnValueOnce(undefined);
      mocks.runAudioBackendEffect.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            resolveWrite = resolve;
            rejectWrite = reject;
          }),
      );

      await act(async () => {
        resolveCover?.(cover);
        await vi.waitFor(() => expect(mocks.writeTags).toHaveBeenCalled());
      });

      expect(mocks.writeTags).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ comment: "keep this edit", picture: cover }),
      );
      act(() => {
        void comment.onChange({
          target: { name: "comment", value: "keep the latest edit" },
          type: "change",
        });
        hook.result.editor.commands.flush();
        const snapshot = hook.result.library.getSnapshot();
        hook.result.library.dispatch({
          type: "track-selected",
          albumId: snapshot.albums[0]?.id ?? null,
          fileId: snapshot.files[1]?.id ?? null,
          mode: "replace",
        });
      });
      await act(async () => {
        if (outcome === "success") {
          resolveWrite?.(written);
          await vi.waitFor(() =>
            expect(hook.result.library.getSnapshot().files[0]?.file).toBe(written),
          );
        } else {
          rejectWrite?.(new Error("write failed"));
          await vi.waitFor(() =>
            expect(hook.result.library.getSnapshot().files[0]?.status).toBe("error"),
          );
        }
      });

      expect(hook.result.editor.form.getValues("picture")).toEqual(cover);
      expect(hook.result.library.getSnapshot().files[0]).toMatchObject({
        status: outcome === "success" ? "pending" : "error",
        hasBufferedChanges: true,
        metadata: { comment: "keep the latest edit", picture: cover },
        pendingMetadataPatch: { comment: "keep the latest edit" },
      });
      act(() => hook.result.importing.commands.cancelQueue());
      hook.unmount();
    },
  );

  it("keeps the requested format while using later non-format settings after metadata resolution", async () => {
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
      { currentSettings: settings("320", "best"), activateEditor: firstActivation },
    );

    let importing: Promise<void> | undefined;
    act(() => {
      importing = hook.result.importing.commands.importUrl(
        "https://www.youtube.com/watch?v=abcdefghijk",
      );
    });
    await vi.waitFor(() => expect(resolveMetadata).toBeTypeOf("function"));
    hook.rerender({ currentSettings: settings("128", "mp3"), activateEditor: latestActivation });
    resolveMetadata?.({ title: "Latest Track", artist: "Artist" });
    await act(async () => importing);

    expect(firstActivation).not.toHaveBeenCalled();
    expect(latestActivation).toHaveBeenCalledOnce();
    expect(hook.result.library.getSnapshot().files[0].downloadRequest?.audioBitrate).toBe("128");
    expect(hook.result.library.getSnapshot().files[0].downloadRequest?.audioFormat).toBe("best");
    expect(hook.result.library.getSnapshot().files[0].downloadRequest?.importId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    act(() => hook.result.importing.commands.cancelQueue());
    hook.unmount();
  });
});
