import { Effect } from "effect";
import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import { AudioBackend } from "@/features/audio/audioBackend";
import { renderHook } from "../../support/hookTestHarness";
import { useLibraryStore } from "@/features/library/useLibraryStore";
import { useTrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";

const settings: AppSettings = {
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
    format: "mp3",
    filename: file.name,
    file,
    originalFile: file,
    status: "saved",
    downloadStatus: "ready",
    metadata: metadata(title),
  };
};

describe("track editor session", () => {
  it("flushes dirty metadata before selection and resets the next form", () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings }) };
    }, undefined);
    const first = readyFile("first", "First");
    const second = readyFile("second", "Second");
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [first, second],
        looseTrackIds: [first.id, second.id],
        selection: { selectedAlbumId: null, selectedFileId: first.id },
      });
    });

    const title = hook.result.editor.form.register("title");
    act(() => {
      void title.onChange({ target: { name: "title", value: "Edited First" }, type: "change" });
    });
    act(() => hook.result.editor.commands.preview("title", "Edited First"));
    expect(hook.result.library.getSnapshot().files[0]).toMatchObject({
      status: "pending",
      hasBufferedChanges: true,
      metadata: { title: "Edited First" },
      pendingMetadataPatch: { title: "Edited First" },
    });

    act(() => {
      hook.result.editor.commands.flush();
      hook.result.library.dispatch({
        type: "track-selected",
        albumId: null,
        fileId: second.id,
        mode: "replace",
      });
    });
    act(() => {
      hook.result.editor.commands.flush();
    });

    expect(hook.result.editor.selectedFile?.id).toBe(second.id);
    expect(hook.result.library.getSnapshot().files[1].metadata?.title).toBe("Second");
    hook.unmount();
  });

  it("preserves pending edits while hydrating a downloaded file", async () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings }) };
    }, undefined);
    const pending: TagiumFile = {
      id: "remote",
      format: "mp3",
      filename: "edited.mp3",
      status: "pending",
      downloadStatus: "downloading",
      hasBufferedChanges: true,
      pendingMetadataPatch: { filename: "edited", title: "Edited" },
      metadata: metadata("Edited"),
    };
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [pending],
        looseTrackIds: [pending.id],
        selection: { selectedAlbumId: null, selectedFileId: pending.id },
      });
    });
    const downloaded = new File(["download"], "downloaded.mp3");
    const parsedFile: TagiumFile = {
      id: "parsed",
      format: "mp3",
      filename: downloaded.name,
      file: downloaded,
      originalFile: downloaded,
      status: "saved",
      downloadStatus: "ready",
      metadata: metadata("Parsed"),
    };
    const written = new File(["written"], "edited.mp3");
    const backend = AudioBackend.of({
      downloadFromCobalt: () => Effect.fail(new Error("unused")),
      parseUploads: () =>
        Effect.succeed([{ file: parsedFile, albumSeed: { title: "", artist: "", genre: "" } }]),
      writeTags: vi.fn(() => Effect.succeed(written)),
    });

    await act(async () => {
      await Effect.runPromise(
        hook.result.editor.commands
          .hydrateDownloadedTrack(pending.id, downloaded)
          .pipe(Effect.provideService(AudioBackend, backend)),
      );
    });

    expect(hook.result.library.getSnapshot().files[0]).toMatchObject({
      id: pending.id,
      filename: written.name,
      file: written,
      status: "saved",
      downloadStatus: "ready",
      hasBufferedChanges: false,
      metadata: { title: "Edited", duration: 120 },
    });
    hook.unmount();
  });
});
