import { Effect } from "effect";
import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import { AudioBackend } from "@/features/audio/audioBackend";
import { renderHook } from "../../support/hookTestHarness";
import { useLibraryStore } from "@/features/library/useLibraryStore";
import { useTrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";

const settings: AppSettings = {
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
  discNumber: null,
  composer: "",
  bpm: null,
  comment: "",
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
  const advancedSettings: AppSettings = {
    ...settings,
    advancedMetadata: true,
  };

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

  it("drops malformed-only pending numbers before successful hydration", async () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings: advancedSettings }) };
    }, undefined);
    const pending: TagiumFile = {
      id: "remote",
      format: "mp3",
      filename: "remote.mp3",
      status: "pending",
      downloadStatus: "downloading",
      hasBufferedChanges: true,
      pendingMetadataPatch: { discNumber: Number.NaN, bpm: undefined },
      metadata: { ...metadata("Provider"), discNumber: 2, bpm: 128 },
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
      ...readyFile("parsed", "Parsed"),
      file: downloaded,
      originalFile: downloaded,
      filename: downloaded.name,
      metadata: { ...metadata("Parsed"), discNumber: 4, bpm: 140 },
    };
    const writeTags = vi.fn(() => Effect.succeed(new File(["written"], "remote.mp3")));
    const backend = AudioBackend.of({
      downloadFromCobalt: () => Effect.fail(new Error("unused")),
      parseUploads: () =>
        Effect.succeed([{ file: parsedFile, albumSeed: { title: "", artist: "", genre: "" } }]),
      writeTags,
    });

    await act(async () => {
      await Effect.runPromise(
        hook.result.editor.commands
          .hydrateDownloadedTrack(pending.id, downloaded)
          .pipe(Effect.provideService(AudioBackend, backend)),
      );
    });

    expect(writeTags).not.toHaveBeenCalled();
    expect(hook.result.library.getSnapshot().files[0]).toMatchObject({
      status: "saved",
      hasBufferedChanges: false,
      metadata: { title: "Parsed", discNumber: 4, bpm: 140 },
    });
    expect(hook.result.library.getSnapshot().files[0]?.pendingMetadataPatch).toBeUndefined();
    hook.unmount();
  });

  it("keeps malformed pending numbers out of hydration write-error recovery", async () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings: advancedSettings }) };
    }, undefined);
    const pending: TagiumFile = {
      id: "remote",
      format: "mp3",
      filename: "edited.mp3",
      status: "pending",
      downloadStatus: "downloading",
      hasBufferedChanges: true,
      pendingMetadataPatch: {
        title: "Edited",
        discNumber: Number.NaN,
        bpm: undefined,
      },
      metadata: { ...metadata("Edited"), discNumber: 2, bpm: 128 },
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
      ...readyFile("parsed", "Parsed"),
      file: downloaded,
      originalFile: downloaded,
      filename: downloaded.name,
      metadata: { ...metadata("Parsed"), discNumber: 4, bpm: 140 },
    };
    const writeTags = vi.fn(() => Effect.fail(new Error("write failed")));
    const backend = AudioBackend.of({
      downloadFromCobalt: () => Effect.fail(new Error("unused")),
      parseUploads: () =>
        Effect.succeed([{ file: parsedFile, albumSeed: { title: "", artist: "", genre: "" } }]),
      writeTags,
    });

    await act(async () => {
      await Effect.runPromise(
        hook.result.editor.commands
          .hydrateDownloadedTrack(pending.id, downloaded)
          .pipe(Effect.provideService(AudioBackend, backend)),
      );
    });

    expect(writeTags).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: "Edited", discNumber: 4, bpm: 140 }),
    );
    const recoveredFile = hook.result.library.getSnapshot().files[0];
    expect(recoveredFile).toMatchObject({
      status: "error",
      metadata: { title: "Edited", discNumber: 2, bpm: 128 },
      pendingMetadataPatch: { title: "Edited" },
    });
    expect(recoveredFile?.pendingMetadataPatch ?? {}).not.toHaveProperty("discNumber");
    expect(recoveredFile?.pendingMetadataPatch ?? {}).not.toHaveProperty("bpm");
    hook.unmount();
  });

  it("buffers linked album artist whenever artist is edited", () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings }) };
    }, undefined);
    const file = readyFile("track", "Track");
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file],
        looseTrackIds: [file.id],
        selection: { selectedAlbumId: null, selectedFileId: file.id },
      });
    });

    const artist = hook.result.editor.form.register("artist");
    act(() => {
      void artist.onChange({ target: { name: "artist", value: "New Artist" }, type: "change" });
    });
    act(() => {
      hook.result.editor.commands.flush();
    });

    expect(hook.result.library.getSnapshot().files[0]).toMatchObject({
      metadata: { artist: "New Artist", albumArtist: "New Artist" },
      pendingMetadataPatch: { artist: "New Artist", albumArtist: "New Artist" },
    });
    hook.unmount();
  });

  it("preserves hidden advanced values while normal metadata is edited", () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings }) };
    }, undefined);
    const file = readyFile("track", "Track");
    file.metadata = {
      ...file.metadata!,
      discNumber: 2,
      composer: "Composer",
      bpm: 134,
      comment: "Keep this note",
    };
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file],
        looseTrackIds: [file.id],
        selection: { selectedAlbumId: null, selectedFileId: file.id },
      });
    });

    const title = hook.result.editor.form.register("title");
    act(() => {
      void title.onChange({ target: { name: "title", value: "Edited" }, type: "change" });
    });
    act(() => {
      hook.result.editor.commands.flush();
    });

    expect(hook.result.library.getSnapshot().files[0].metadata).toMatchObject({
      title: "Edited",
      albumArtist: "Artist",
      discNumber: 2,
      composer: "Composer",
      bpm: 134,
      comment: "Keep this note",
    });
    hook.unmount();
  });

  it.each([0, 1.5])("keeps disc number %s out of album export projection", (invalidDiscNumber) => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings: advancedSettings }) };
    }, undefined);
    const file = readyFile("track", "Track");
    file.metadata = { ...file.metadata!, discNumber: 2 };
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file],
        looseTrackIds: [file.id],
        selection: { selectedAlbumId: null, selectedFileId: file.id },
      });
    });

    const discNumber = hook.result.editor.form.register("discNumber");
    act(() => {
      void discNumber.onChange({
        target: { name: "discNumber", value: invalidDiscNumber },
        type: "change",
      });
    });
    const projectedFiles = hook.result.editor.commands.flush([file.id]);

    expect(projectedFiles[0]?.metadata?.discNumber).toBe(2);
    expect(projectedFiles[0]?.pendingMetadataPatch ?? {}).not.toHaveProperty("discNumber");
    hook.unmount();
  });

  it.each([0, 1_000])("keeps BPM %s out of library export projection", (invalidBpm) => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings: advancedSettings }) };
    }, undefined);
    const file = readyFile("track", "Track");
    file.metadata = { ...file.metadata!, bpm: 128 };
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file],
        looseTrackIds: [file.id],
        selection: { selectedAlbumId: null, selectedFileId: file.id },
      });
    });

    const bpm = hook.result.editor.form.register("bpm");
    act(() => {
      void bpm.onChange({ target: { name: "bpm", value: invalidBpm }, type: "change" });
    });
    const projectedFiles = hook.result.editor.commands.flush();

    expect(projectedFiles[0]?.metadata?.bpm).toBe(128);
    expect(projectedFiles[0]?.pendingMetadataPatch ?? {}).not.toHaveProperty("bpm");
    hook.unmount();
  });

  it("projects valid advanced numbers for bulk export", () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings: advancedSettings }) };
    }, undefined);
    const file = readyFile("track", "Track");
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file],
        looseTrackIds: [file.id],
        selection: { selectedAlbumId: null, selectedFileId: file.id },
      });
    });

    const discNumber = hook.result.editor.form.register("discNumber");
    const bpm = hook.result.editor.form.register("bpm");
    act(() => {
      void discNumber.onChange({ target: { name: "discNumber", value: 3 }, type: "change" });
      void bpm.onChange({ target: { name: "bpm", value: 128.5 }, type: "change" });
    });
    const projectedFiles = hook.result.editor.commands.flush();

    expect(projectedFiles[0]?.metadata).toMatchObject({ discNumber: 3, bpm: 128.5 });
    expect(projectedFiles[0]?.pendingMetadataPatch).toMatchObject({ discNumber: 3, bpm: 128.5 });
    hook.unmount();
  });

  it("sanitizes invalid advanced fields before normal preview and every bulk projection", () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings: advancedSettings }) };
    }, undefined);
    const file = readyFile("track", "Track");
    file.metadata = { ...file.metadata!, discNumber: 2, bpm: 128 };
    file.pendingMetadataPatch = { discNumber: 0, bpm: 1_000 };
    file.hasBufferedChanges = true;
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file],
        looseTrackIds: [file.id],
        selection: { selectedAlbumId: null, selectedFileId: file.id },
      });
    });

    const discNumber = hook.result.editor.form.register("discNumber");
    const bpm = hook.result.editor.form.register("bpm");
    act(() => {
      void discNumber.onChange({ target: { name: "discNumber", value: 1.5 }, type: "change" });
      void bpm.onChange({ target: { name: "bpm", value: 0 }, type: "change" });
    });
    act(() => hook.result.editor.commands.preview("title", "Previewed title"));

    const previewedFile = hook.result.library.getSnapshot().files[0];
    expect(previewedFile?.metadata).toMatchObject({
      title: "Previewed title",
      discNumber: 2,
      bpm: 128,
    });
    expect(previewedFile?.pendingMetadataPatch).toMatchObject({ title: "Previewed title" });
    expect(previewedFile?.pendingMetadataPatch ?? {}).not.toHaveProperty("discNumber");
    expect(previewedFile?.pendingMetadataPatch ?? {}).not.toHaveProperty("bpm");

    for (const projectedFile of [
      hook.result.editor.commands.flush([file.id])[0],
      hook.result.editor.commands.flush()[0],
    ]) {
      expect(projectedFile?.metadata).toMatchObject({ discNumber: 2, bpm: 128 });
      expect(projectedFile?.pendingMetadataPatch ?? {}).not.toHaveProperty("discNumber");
      expect(projectedFile?.pendingMetadataPatch ?? {}).not.toHaveProperty("bpm");
    }
    hook.unmount();
  });

  it("deletes raw NaN and present undefined from legacy pending metadata", () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings: advancedSettings }) };
    }, undefined);
    const file = readyFile("track", "Track");
    file.metadata = { ...file.metadata!, discNumber: 2, bpm: 128 };
    file.pendingMetadataPatch = { discNumber: Number.NaN, bpm: undefined };
    file.hasBufferedChanges = true;
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file],
        looseTrackIds: [file.id],
        selection: { selectedAlbumId: null, selectedFileId: file.id },
      });
    });

    act(() => hook.result.editor.commands.preview("title", "Previewed title"));

    for (const projectedFile of [
      hook.result.library.getSnapshot().files[0],
      hook.result.editor.commands.flush([file.id])[0],
      hook.result.editor.commands.flush()[0],
    ]) {
      expect(projectedFile?.metadata).toMatchObject({ discNumber: 2, bpm: 128 });
      expect(projectedFile?.pendingMetadataPatch ?? {}).not.toHaveProperty("discNumber");
      expect(projectedFile?.pendingMetadataPatch ?? {}).not.toHaveProperty("bpm");
    }
    hook.unmount();
  });

  it("rejects raw NaN and present undefined before dirty-form preview and bulk projection", () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings: advancedSettings }) };
    }, undefined);
    const file = readyFile("track", "Track");
    file.metadata = { ...file.metadata!, discNumber: 2, bpm: 128 };
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file],
        looseTrackIds: [file.id],
        selection: { selectedAlbumId: null, selectedFileId: file.id },
      });
    });

    const discNumber = hook.result.editor.form.register("discNumber");
    const bpm = hook.result.editor.form.register("bpm");
    act(() => {
      void discNumber.onChange({
        target: { name: "discNumber", value: Number.NaN },
        type: "change",
      });
      void bpm.onChange({ target: { name: "bpm", value: undefined }, type: "change" });
    });
    act(() => hook.result.editor.commands.preview("title", "Previewed title"));

    for (const projectedFile of [
      hook.result.library.getSnapshot().files[0],
      hook.result.editor.commands.flush([file.id])[0],
      hook.result.editor.commands.flush()[0],
    ]) {
      expect(projectedFile?.metadata).toMatchObject({ discNumber: 2, bpm: 128 });
      expect(projectedFile?.pendingMetadataPatch ?? {}).not.toHaveProperty("discNumber");
      expect(projectedFile?.pendingMetadataPatch ?? {}).not.toHaveProperty("bpm");
    }
    hook.unmount();
  });

  it("rejects malformed direct writes but preserves explicit null clears", async () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings: advancedSettings }) };
    }, undefined);
    const file = readyFile("track", "Track");
    file.file = undefined;
    file.originalFile = undefined;
    file.metadata = { ...file.metadata!, discNumber: 2, bpm: 128 };
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file],
        looseTrackIds: [file.id],
        selection: { selectedAlbumId: null, selectedFileId: file.id },
      });
    });

    const malformedMetadata = {
      ...file.metadata,
      discNumber: Number.NaN,
      bpm: undefined,
    } as unknown as AudioMetadata;
    await act(async () => {
      await hook.result.editor.commands.updateTags(file, malformedMetadata);
    });
    expect(hook.result.library.getSnapshot().files[0]?.metadata).toMatchObject({
      discNumber: 2,
      bpm: 128,
    });

    await act(async () => {
      await hook.result.editor.commands.updateTags(file, {
        ...file.metadata!,
        discNumber: null,
        bpm: null,
      });
    });
    expect(hook.result.library.getSnapshot().files[0]?.metadata).toMatchObject({
      discNumber: null,
      bpm: null,
    });
    hook.unmount();
  });

  it("preserves explicit null and valid numbers in pending metadata", () => {
    const hook = renderHook(() => {
      const library = useLibraryStore();
      return { library, editor: useTrackEditorSession({ library, settings: advancedSettings }) };
    }, undefined);
    const file = readyFile("track", "Track");
    file.metadata = { ...file.metadata!, discNumber: null, bpm: 128.5 };
    file.pendingMetadataPatch = { discNumber: null, bpm: 128.5 };
    file.hasBufferedChanges = true;
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file],
        looseTrackIds: [file.id],
        selection: { selectedAlbumId: null, selectedFileId: file.id },
      });
    });

    act(() => hook.result.editor.commands.preview("title", "Previewed title"));
    const projectedFile = hook.result.editor.commands.flush();

    expect(projectedFile[0]?.metadata).toMatchObject({ discNumber: null, bpm: 128.5 });
    expect(projectedFile[0]?.pendingMetadataPatch).toMatchObject({
      title: "Previewed title",
      discNumber: null,
      bpm: 128.5,
    });
    hook.unmount();
  });

  it("mirrors album artist when the advanced gate is turned off before hydration writes", async () => {
    const unlinkedAdvancedSettings: AppSettings = {
      ...settings,
      advancedMetadata: true,
      metadataLinks: { ...settings.metadataLinks, albumArtist: false },
    };
    const hook = renderHook(
      ({ currentSettings }: { currentSettings: AppSettings }) => {
        const library = useLibraryStore();
        return {
          library,
          editor: useTrackEditorSession({ library, settings: currentSettings }),
        };
      },
      { currentSettings: unlinkedAdvancedSettings },
    );
    const pending: TagiumFile = {
      id: "remote",
      format: "mp3",
      filename: "remote.mp3",
      status: "pending",
      downloadStatus: "downloading",
      hasBufferedChanges: true,
      pendingMetadataPatch: { albumArtist: "Custom Album Artist" },
      metadata: { ...metadata("Track"), albumArtist: "Custom Album Artist" },
    };
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [pending],
        looseTrackIds: [pending.id],
        selection: { selectedAlbumId: null, selectedFileId: pending.id },
      });
    });
    hook.rerender({
      currentSettings: {
        ...unlinkedAdvancedSettings,
        advancedMetadata: false,
      },
    });

    const downloaded = new File(["download"], "downloaded.mp3");
    const parsedFile: TagiumFile = {
      ...readyFile("parsed", "Parsed"),
      file: downloaded,
      originalFile: downloaded,
      filename: downloaded.name,
    };
    const written = new File(["written"], "remote.mp3");
    const writeTags = vi.fn(() => Effect.succeed(written));
    const backend = AudioBackend.of({
      downloadFromCobalt: () => Effect.fail(new Error("unused")),
      parseUploads: () =>
        Effect.succeed([{ file: parsedFile, albumSeed: { title: "", artist: "", genre: "" } }]),
      writeTags,
    });

    await act(async () => {
      await Effect.runPromise(
        hook.result.editor.commands
          .hydrateDownloadedTrack(pending.id, downloaded)
          .pipe(Effect.provideService(AudioBackend, backend)),
      );
    });

    expect(writeTags).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ artist: "Artist", albumArtist: "Artist" }),
    );
    expect(hook.result.library.getSnapshot().files[0].metadata?.albumArtist).toBe("Artist");
    hook.unmount();
  });
});
