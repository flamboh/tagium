import { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AlbumGroup, TagiumFile } from "@/features/library/types";
import type { LibraryStore } from "@/features/library/useLibraryStore";

const mocks = vi.hoisted(() => ({
  fetchSharedAlbum: vi.fn(),
  fetchSharedAlbumArtwork: vi.fn(),
  publishSharedAlbum: vi.fn(),
  updateSharedAlbum: vi.fn(),
  revokeSharedAlbum: vi.fn(),
  getRevocationReceipt: vi.fn(),
  storeRevocationReceipt: vi.fn(),
  removeRevocationReceipt: vi.fn(),
  importSharedAlbum: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/features/share/shareClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/share/shareClient")>()),
  fetchSharedAlbum: mocks.fetchSharedAlbum,
  fetchSharedAlbumArtwork: mocks.fetchSharedAlbumArtwork,
  publishSharedAlbum: mocks.publishSharedAlbum,
  updateSharedAlbum: mocks.updateSharedAlbum,
  revokeSharedAlbum: mocks.revokeSharedAlbum,
}));
vi.mock("@/features/share/revocationReceipt", () => ({
  getRevocationReceipt: mocks.getRevocationReceipt,
  storeRevocationReceipt: mocks.storeRevocationReceipt,
  removeRevocationReceipt: mocks.removeRevocationReceipt,
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

const creatorWorkflow = (album: AlbumGroup, file: TagiumFile) => {
  const albums = [album];
  const files = [file];
  const library = {
    state: { albums, files },
    getSnapshot: () => ({ albums, files }),
    dispatch: vi.fn((action: { type: string; albumId?: string; publication?: unknown }) => {
      if (action.type === "album-share-publication-set" && action.albumId === album.id) {
        album.sharePublication = action.publication as AlbumGroup["sharePublication"];
      }
    }),
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
  return { hook, library };
};

const creatorFile: TagiumFile = {
  id: "track-1",
  filename: "one.mp3",
  status: "saved",
  downloadStatus: "ready",
  downloadRequest: {
    sourceUrl: "https://soundcloud.com/artist/one",
    audioBitrate: "320",
  },
  metadata: {
    filename: "one",
    title: "One",
    artist: "Artist",
    albumArtist: "Artist",
    album: "Shared",
    genre: "Pop",
    year: null,
    trackNumber: null,
    composer: "",
    comment: "",
    discNumber: null,
    bpm: null,
    picture: [],
    bitrate: 320,
    duration: 180,
    sampleRate: 44_100,
  },
};

const creatorAlbum = (sharePublication?: AlbumGroup["sharePublication"]): AlbumGroup => ({
  id: "album-1",
  title: "Shared",
  artist: "Artist",
  genre: "Pop",
  trackIds: [creatorFile.id],
  sharePublication,
});

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
    expect(mocks.toastSuccess).toHaveBeenCalledWith("album added to your library", {
      description: "downloading 1 track — watch progress in the sidebar.",
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith(expect.stringContaining("at a time"));
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

  it("reports download progress after adding from a share preview", async () => {
    history.replaceState({}, "", `/share/${slug}`);
    mocks.fetchSharedAlbum.mockResolvedValue({
      manifest: sharedManifest,
      expiresAt: "2026-10-20T12:00:00.000Z",
    });
    const { hook } = workflow();

    await vi.waitFor(() => expect(hook.result.page).toMatchObject({ status: "ready", slug }));
    await act(async () => hook.result.addSharedAlbum());

    expect(mocks.toastSuccess).toHaveBeenCalledWith("album added to your library", {
      description: "downloading 1 track — watch progress in the sidebar.",
    });
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

describe("share workflow publication lifecycle", () => {
  const oldPublication = {
    slug: "old-share",
    url: "https://tagium.app/share/old-share",
    expiresAt: "2030-01-01T00:00:00.000Z",
    publishedFingerprint: "old-fingerprint",
    status: "active" as const,
  };
  const capability = {
    slug: oldPublication.slug,
    expiresAt: oldPublication.expiresAt,
    token: "old-token",
  };

  it("replaces a stopped publication with a fresh link", async () => {
    const album = creatorAlbum({ ...oldPublication, status: "stopped" });
    const { hook } = creatorWorkflow(album, creatorFile);
    mocks.publishSharedAlbum.mockResolvedValue({
      slug: "new-share",
      url: "https://tagium.app/share/new-share",
      expiresAt: "2031-01-01T00:00:00.000Z",
      revocationToken: "new-token",
    });

    act(() => hook.result.openCreator(album.id));
    expect(hook.result.dialog).toMatchObject({ status: "confirm", intent: "create" });
    await act(async () => hook.result.publish());

    expect(mocks.publishSharedAlbum).toHaveBeenCalledOnce();
    expect(mocks.updateSharedAlbum).not.toHaveBeenCalled();
    expect(album.sharePublication).toMatchObject({
      slug: "new-share",
      status: "active",
    });
    hook.unmount();
  });

  it("surfaces a recovery message if view-link permission disappears", () => {
    const album = creatorAlbum(oldPublication);
    mocks.getRevocationReceipt.mockReturnValue(capability);
    const { hook } = creatorWorkflow(album, creatorFile);
    mocks.getRevocationReceipt
      .mockReset()
      .mockReturnValueOnce(capability)
      .mockReturnValueOnce(null);

    act(() => hook.result.openCreator(album.id));

    expect(hook.result.dialog).toEqual({ status: "closed" });
    expect(mocks.toastError).toHaveBeenCalledWith("share link permission unavailable", {
      description: "try the browser that created this link",
    });
    hook.unmount();
  });

  it("explains that a failed create did not produce a link", async () => {
    const album = creatorAlbum();
    mocks.publishSharedAlbum.mockRejectedValue(new Error("sharing is unavailable"));
    const { hook } = creatorWorkflow(album, creatorFile);

    act(() => hook.result.openCreator(album.id));
    await act(async () => hook.result.publish());

    await vi.waitFor(() =>
      expect(hook.result.dialog).toMatchObject({
        status: "error",
        intent: "create",
        message: "the share link could not be created.",
      }),
    );
    hook.unmount();
  });

  it("explains that a failed update left the previous link version intact", async () => {
    const album = creatorAlbum(oldPublication);
    mocks.getRevocationReceipt.mockReturnValue(capability);
    mocks.updateSharedAlbum.mockRejectedValue(new Error("offline"));
    const { hook } = creatorWorkflow(album, creatorFile);

    await vi.waitFor(() =>
      expect(hook.result.shareActions[album.id]?.label).toBe("update shared album"),
    );
    act(() => hook.result.openCreator(album.id));
    await act(async () => hook.result.publish());

    await vi.waitFor(() =>
      expect(hook.result.dialog).toMatchObject({
        status: "error",
        intent: "update",
        message: "the shared album could not be updated. the link still has the previous version.",
      }),
    );
    hook.unmount();
  });
});
