import { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { LibraryStore } from "@/features/library/useLibraryStore";

const mocks = vi.hoisted(() => ({
  fetchSharedAlbum: vi.fn(),
  fetchSharedAlbumArtwork: vi.fn(),
  importSharedAlbum: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/share/shareClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/share/shareClient")>()),
  fetchSharedAlbum: mocks.fetchSharedAlbum,
  fetchSharedAlbumArtwork: mocks.fetchSharedAlbumArtwork,
}));
vi.mock("@/features/share/sharePresence", () => ({
  detectAnotherTagiumTab: vi.fn(async () => false),
  listenForTagiumPresence: vi.fn(() => () => undefined),
}));

import { renderHook } from "../../support/hookTestHarness";
import { useShareWorkflow } from "@/features/share/useShareWorkflow";
import { SharedAlbumUnavailableError } from "@/features/share/shareClient";

const slug = "AbcdEFGHijklmno_123-45";
const sharedManifest = {
  version: 1 as const,
  kind: "album" as const,
  album: { title: "Shared", artist: "Artist", genre: "Pop" },
  tracks: [
    {
      sourceUrl: "https://soundcloud.com/artist/track",
      audioBitrate: "320" as const,
      metadata: {
        filename: "track",
        title: "Track",
        artist: "Artist",
        album: "Shared",
        genre: "Pop",
      },
    },
  ],
};

const workflow = (albums: Array<{ id: string; sourceManifestSlug?: string }> = []) => {
  const events: string[] = [];
  const library = {
    state: { albums },
    getSnapshot: () => ({ albums, files: [] }),
    dispatch: vi.fn(() => events.push("select")),
  } as unknown as LibraryStore;
  const editor = { commands: { flush: vi.fn(() => events.push("flush")) } };
  const importing = { commands: { importSharedAlbum: mocks.importSharedAlbum } };
  const hook = renderHook(
    () =>
      useShareWorkflow({
        library,
        editor: editor as never,
        importing: importing as never,
        enabled: true,
      }),
    undefined,
  );
  return { hook, library, editor, events };
};

beforeEach(() => {
  const location = { pathname: "/" };
  const fakeHistory: {
    state: unknown;
    replaceState: (state: unknown, title: string, path: string) => void;
    back: ReturnType<typeof vi.fn>;
  } = {
    state: {},
    replaceState: (state: unknown, _title: string, path: string) => {
      fakeHistory.state = state;
      location.pathname = path;
    },
    back: vi.fn(),
  };
  vi.stubGlobal("location", location);
  vi.stubGlobal("history", fakeHistory);
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("share workflow pasted links", () => {
  it("flushes buffered editor metadata before selecting an already-added album", async () => {
    const { hook, library, editor, events } = workflow([
      { id: "album-1", sourceManifestSlug: slug },
    ]);

    await act(async () => hook.result.importFromInput(slug));

    expect(events).toEqual(["flush", "select"]);
    expect(editor.commands.flush).toHaveBeenCalledOnce();
    expect(library.dispatch).toHaveBeenCalledWith({
      type: "album-selected",
      albumId: "album-1",
      mode: "replace",
    });
    expect(mocks.fetchSharedAlbum).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("imports a pasted link in place without changing browser history, and ignores a concurrent submit", async () => {
    const { hook } = workflow();
    let resolveFetch:
      | ((value: { manifest: typeof sharedManifest; expiresAt: string }) => void)
      | undefined;
    const pending = new Promise<{ manifest: typeof sharedManifest; expiresAt: string }>(
      (resolve) => {
        resolveFetch = resolve;
      },
    );
    mocks.fetchSharedAlbum.mockReturnValue(pending);
    const before = location.pathname;

    const first = hook.result.importFromInput(slug);
    const second = hook.result.importFromInput(slug);
    resolveFetch?.({ manifest: sharedManifest, expiresAt: "2026-10-20T12:00:00.000Z" });
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(location.pathname).toBe(before);
    expect(mocks.fetchSharedAlbum).toHaveBeenCalledOnce();
    expect(mocks.importSharedAlbum).toHaveBeenCalledWith(sharedManifest, slug, undefined);
    hook.unmount();
  });

  it("keeps a direct share route as a preview until its explicit add action", async () => {
    history.replaceState({}, "", `/share/${slug}`);
    mocks.fetchSharedAlbum.mockResolvedValue({
      manifest: sharedManifest,
      expiresAt: "2026-10-20T12:00:00.000Z",
    });
    const { hook } = workflow();

    await vi.waitFor(() => expect(hook.result.page).toMatchObject({ status: "ready", slug }));
    expect(mocks.importSharedAlbum).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("rejects pasted links safely when sharing is disabled", async () => {
    const library = {
      state: { albums: [] },
      getSnapshot: () => ({ albums: [], files: [] }),
      dispatch: vi.fn(),
    } as unknown as LibraryStore;
    const hook = renderHook(
      () =>
        useShareWorkflow({
          library,
          editor: { commands: { flush: vi.fn() } } as never,
          importing: { commands: { importSharedAlbum: vi.fn() } } as never,
          enabled: false,
        }),
      undefined,
    );

    await expect(hook.result.importFromInput(slug)).rejects.toBeInstanceOf(
      SharedAlbumUnavailableError,
    );
    hook.unmount();
  });
});
