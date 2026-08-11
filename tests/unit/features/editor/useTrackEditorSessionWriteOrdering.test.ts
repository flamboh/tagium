import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";

const mocks = vi.hoisted(() => ({
  runAudioBackendEffect: vi.fn(),
  writeTags: vi.fn(),
}));

vi.mock("@/features/audio/audioBackend", () => ({
  parseUploads: vi.fn(),
  runAudioBackendEffect: mocks.runAudioBackendEffect,
  writeTags: mocks.writeTags,
}));

import { useTrackEditorSession } from "@/features/editor/useTrackEditorSession";
import { useLibraryStore } from "@/features/library/useLibraryStore";
import { renderHook } from "../../support/hookTestHarness";

const settings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  syncFilenames: false,
};

const metadata = (title: string): AudioMetadata => ({
  filename: title.toLowerCase().replaceAll(" ", "-"),
  title,
  artist: "artist",
  albumArtist: "artist",
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

const readyFile = (): TagiumFile => {
  const file = new File(["initial"], "track.mp3", { type: "audio/mpeg" });
  return {
    id: "track",
    filename: file.name,
    file,
    originalFile: file,
    status: "saved",
    downloadStatus: "ready",
    metadata: metadata("initial"),
  };
};

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const createHarness = () => {
  const hook = renderHook(() => {
    const library = useLibraryStore();
    return { library, editor: useTrackEditorSession({ library, settings }) };
  }, undefined);
  const initialFile = readyFile();
  act(() => {
    hook.result.library.dispatch({
      type: "content-replaced",
      files: [initialFile],
      looseTrackIds: [initialFile.id],
    });
  });
  return { hook, initialFile };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("track editor metadata write ordering", () => {
  it("ignores an older write that succeeds after a newer write", async () => {
    const olderBackendWrite = deferred<File>();
    const newerBackendWrite = deferred<File>();
    mocks.runAudioBackendEffect
      .mockReturnValueOnce(olderBackendWrite.promise)
      .mockReturnValueOnce(newerBackendWrite.promise);
    const { hook, initialFile } = createHarness();

    let olderUpdate!: Promise<void>;
    let newerUpdate!: Promise<void>;
    act(() => {
      olderUpdate = hook.result.editor.commands.updateTags(initialFile, metadata("older"));
      newerUpdate = hook.result.editor.commands.updateTags(initialFile, metadata("newer"));
    });
    const newerFile = new File(["newer"], "newer.mp3", { type: "audio/mpeg" });
    await act(async () => {
      newerBackendWrite.resolve(newerFile);
      await newerUpdate;
    });

    const olderFile = new File(["older"], "older.mp3", { type: "audio/mpeg" });
    await act(async () => {
      olderBackendWrite.resolve(olderFile);
      await olderUpdate;
    });

    expect(hook.result.library.getSnapshot().files[0]).toMatchObject({
      file: newerFile,
      originalFile: newerFile,
      filename: newerFile.name,
      status: "saved",
      metadata: { title: "newer" },
    });
    hook.unmount();
  });

  it("ignores an older write that fails after a newer write succeeds", async () => {
    const olderBackendWrite = deferred<File>();
    const newerBackendWrite = deferred<File>();
    mocks.runAudioBackendEffect
      .mockReturnValueOnce(olderBackendWrite.promise)
      .mockReturnValueOnce(newerBackendWrite.promise);
    const { hook, initialFile } = createHarness();

    let olderUpdate!: Promise<void>;
    let newerUpdate!: Promise<void>;
    act(() => {
      olderUpdate = hook.result.editor.commands.updateTags(initialFile, metadata("older"));
      newerUpdate = hook.result.editor.commands.updateTags(initialFile, metadata("newer"));
    });
    const newerFile = new File(["newer"], "newer.mp3", { type: "audio/mpeg" });
    await act(async () => {
      newerBackendWrite.resolve(newerFile);
      await newerUpdate;
    });

    await act(async () => {
      olderBackendWrite.reject(new Error("older write failed"));
      await expect(olderUpdate).rejects.toThrow("older write failed");
    });

    expect(hook.result.library.getSnapshot().files[0]).toMatchObject({
      file: newerFile,
      originalFile: newerFile,
      filename: newerFile.name,
      status: "saved",
      hasBufferedChanges: false,
      metadata: { title: "newer" },
    });
    expect(hook.result.library.getSnapshot().files[0]?.pendingMetadataPatch).toBeUndefined();
    expect(hook.result.library.getSnapshot().files[0]?.downloadError).toBeUndefined();
    hook.unmount();
  });

  it("ignores the older write when it finishes before the newer write", async () => {
    const olderBackendWrite = deferred<File>();
    const newerBackendWrite = deferred<File>();
    mocks.runAudioBackendEffect
      .mockReturnValueOnce(olderBackendWrite.promise)
      .mockReturnValueOnce(newerBackendWrite.promise);
    const { hook, initialFile } = createHarness();

    let olderUpdate!: Promise<void>;
    let newerUpdate!: Promise<void>;
    act(() => {
      olderUpdate = hook.result.editor.commands.updateTags(initialFile, metadata("older"));
      newerUpdate = hook.result.editor.commands.updateTags(initialFile, metadata("newer"));
    });
    await act(async () => {
      olderBackendWrite.resolve(new File(["older"], "older.mp3", { type: "audio/mpeg" }));
      await olderUpdate;
    });
    expect(hook.result.library.getSnapshot().files[0]).toMatchObject({
      file: initialFile.file,
      filename: initialFile.filename,
      status: "saved",
      metadata: { title: "initial" },
    });

    const newerFile = new File(["newer"], "newer.mp3", { type: "audio/mpeg" });
    await act(async () => {
      newerBackendWrite.resolve(newerFile);
      await newerUpdate;
    });

    expect(hook.result.library.getSnapshot().files[0]).toMatchObject({
      file: newerFile,
      filename: newerFile.name,
      status: "saved",
      metadata: { title: "newer" },
    });
    hook.unmount();
  });

  it("does not restore a track removed during a write", async () => {
    const backendWrite = deferred<File>();
    mocks.runAudioBackendEffect.mockReturnValueOnce(backendWrite.promise);
    const { hook, initialFile } = createHarness();

    let update!: Promise<void>;
    act(() => {
      update = hook.result.editor.commands.updateTags(initialFile, metadata("updated"));
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [],
        looseTrackIds: [],
      });
    });
    await act(async () => {
      backendWrite.resolve(new File(["updated"], "updated.mp3", { type: "audio/mpeg" }));
      await update;
    });

    expect(hook.result.library.getSnapshot().files).toEqual([]);
    hook.unmount();
  });
});
