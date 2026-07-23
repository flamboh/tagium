import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { LibraryStore } from "@/features/library/useLibraryStore";

const { publishSharedAlbum } = vi.hoisted(() => ({ publishSharedAlbum: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/share/shareClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/share/shareClient")>()),
  publishSharedAlbum,
}));
vi.mock("@/features/share/sharePresence", () => ({
  detectAnotherTagiumTab: vi.fn(async () => false),
  listenForTagiumPresence: vi.fn(() => () => undefined),
}));

import { renderHook } from "../../support/hookTestHarness";
import { useShareWorkflow } from "@/features/share/useShareWorkflow";

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
    publishSharedAlbum.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectPublish = reject;
      }),
    );

    const album = { id: "album", title: "Snapshot", artist: "", genre: "", trackIds: ["a", "a"] };
    const files = [
      {
        id: "a",
        filename: "first.mp3",
        metadata: {
          filename: "first.mp3",
          title: "First",
          artist: "Artist",
          album: "Album",
          year: null,
          genre: "Electronic",
          duration: 120,
          bitrate: 320,
          sampleRate: 44100,
          picture: [],
          trackNumber: 1,
        },
        downloadRequest: { sourceUrl: "https://soundcloud.com/a/first", audioBitrate: "320" },
      },
    ];
    const library = {
      state: { albums: [album] },
      getSnapshot: () => ({ albums: [album], files }),
      dispatch: vi.fn(),
    } as unknown as LibraryStore;
    const hook = renderHook(
      () =>
        useShareWorkflow({
          library,
          editor: { commands: { flush: vi.fn() } } as never,
          importing: { commands: { importSharedAlbum: vi.fn() } } as never,
          enabled: true,
        }),
      undefined,
    );

    act(() => hook.result.openCreator("album"));
    const preview = hook.result.dialog.status === "confirm" ? hook.result.dialog.preview : null;
    expect(preview).toMatchObject({
      albumTitle: "Snapshot",
      tracks: [
        { key: "a:0", title: "First" },
        { key: "a:1", title: "First" },
      ],
    });

    act(() => {
      hook.result.publish();
    });
    expect(publishSharedAlbum).toHaveBeenCalledTimes(1);
    expect(hook.result.dialog.status).toBe("publishing");
    rejectPublish(new Error("offline"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.dialog).toMatchObject({ status: "error", preview });
    hook.unmount();
  });
});
