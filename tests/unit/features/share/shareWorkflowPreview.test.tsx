import { act } from "react-test-renderer";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AlbumGroup, TagiumFile } from "@/features/library/types";
import { createLibraryState } from "@/features/library/libraryState";

const { publishShare } = vi.hoisted(() => ({ publishShare: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/share/shareClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/share/shareClient")>()),
  publishShare,
}));
vi.mock("@/features/share/revocationReceipt", () => ({
  getRevocationReceipt: vi.fn((slug: string) => ({
    slug,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    token: "owner-token",
  })),
  removeRevocationReceipt: vi.fn(),
  storeRevocationReceipt: vi.fn(),
}));
vi.mock("@/features/share/sharePresence", () => ({
  detectAnotherTagiumTab: vi.fn(async () => false),
  listenForTagiumPresence: vi.fn(() => () => undefined),
}));

import { renderHook } from "../../support/hookTestHarness";
import { useShareWorkflow } from "@/features/share/useShareWorkflow";

type WorkflowOptions = Parameters<typeof useShareWorkflow>[0];
const fakeEditor = (files: TagiumFile[]): WorkflowOptions["editor"] => ({
  commands: {
    projectFiles: () => files,
    flush: () => files,
    preview: vi.fn(),
    uploadCover: vi.fn(),
    setCoverProcessing: vi.fn(),
    updateTags: vi.fn(async () => undefined),
    hydrateDownloadedTrack: vi.fn(() => Effect.void),
  },
  form: { subscribe: vi.fn(() => () => undefined) },
});
const fakeImporting = (): WorkflowOptions["importing"] => ({
  commands: {
    upload: vi.fn(async () => undefined),
    importUrl: vi.fn(async () => undefined),
    retryTrack: vi.fn(),
    cancelQueue: vi.fn(),
    retryQueue: vi.fn(),
    removeTracks: vi.fn(),
    importSharedContent: vi.fn(async () => undefined),
  },
});

const fakeLibraryStore = (album: AlbumGroup, files: TagiumFile[]): LibraryStore => {
  const state = { ...createLibraryState(), albums: [album], files };
  return { state, getSnapshot: () => state, dispatch: vi.fn() };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("share creator preview state", () => {
  it("retains the exact preview from confirm through publishing and error", async () => {
    const location = { pathname: "/" };
    vi.stubGlobal("location", location);
    vi.stubGlobal("history", { state: {}, replaceState: vi.fn(), back: vi.fn() });
    vi.stubGlobal("window", new EventTarget());
    let rejectPublish!: (error: Error) => void;
    publishShare.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectPublish = reject;
      }),
    );

    const album: AlbumGroup = {
      id: "album",
      title: "Snapshot",
      artist: "",
      genre: "",
      trackIds: ["a", "a"],
    };
    const files: TagiumFile[] = [
      {
        id: "a",
        filename: "first.mp3",
        status: "saved",
        downloadStatus: "ready",
        metadata: {
          filename: "first.mp3",
          title: "First",
          artist: "Artist",
          albumArtist: "Artist",
          album: "Album",
          year: null,
          genre: "Electronic",
          duration: 120,
          bitrate: 320,
          sampleRate: 44100,
          picture: [],
          trackNumber: 1,
          composer: "",
          comment: "",
          discNumber: null,
          bpm: null,
        },
        downloadRequest: {
          sourceUrl: "https://soundcloud.com/a/first",
          audioBitrate: "320",
          audioFormat: "mp3",
        },
      },
    ];
    const library = fakeLibraryStore(album, files);
    const hook = renderHook(
      () =>
        useShareWorkflow({
          library,
          editor: fakeEditor(files),
          importing: fakeImporting(),
          enabled: true,
        }),
      undefined,
    );

    await act(async () => hook.result.openCreator({ kind: "album", id: "album" }));
    const preview = hook.result.dialog.status === "confirm" ? hook.result.dialog.preview : null;
    expect(preview).toMatchObject({
      kind: "album",
      title: "Snapshot",
      tracks: [
        { key: "a:0", title: "First" },
        { key: "a:1", title: "First" },
      ],
    });

    await act(async () => {
      void hook.result.publish();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(publishShare).toHaveBeenCalledTimes(1));
    expect(hook.result.dialog.status).toBe("publishing");
    rejectPublish(new Error("offline"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.dialog).toMatchObject({ status: "error", preview });
    hook.unmount();
  });
});
