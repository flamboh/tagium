import { act } from "react-test-renderer";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AlbumGroup, TagiumFile } from "@/features/library/types";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import { createLibraryState } from "@/features/library/libraryState";

const mocks = vi.hoisted(() => ({
  fetchSharedContent: vi.fn(),
  fetchSharedArtwork: vi.fn(),
  publishShare: vi.fn(),
  updateShare: vi.fn(),
  revokeShare: vi.fn(),
  getRevocationReceipt: vi.fn(),
  storeRevocationReceipt: vi.fn(),
  removeRevocationReceipt: vi.fn(),
  importSharedContent: vi.fn(),
  coverArtFileToPicture: vi.fn(),
  capture: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/analytics", () => ({ analytics: { capture: mocks.capture } }));
vi.mock("@/features/editor/coverArtProcessing", () => ({
  coverArtFileToPicture: mocks.coverArtFileToPicture,
}));
vi.mock("@/features/share/shareClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/share/shareClient")>()),
  fetchSharedContent: mocks.fetchSharedContent,
  fetchSharedArtwork: mocks.fetchSharedArtwork,
  publishShare: mocks.publishShare,
  updateShare: mocks.updateShare,
  revokeShare: mocks.revokeShare,
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
import { projectAlbumShareSnapshot } from "@/features/share/sharePublication";

type WorkflowOptions = Parameters<typeof useShareWorkflow>[0];
const fakeEditor = (
  files: TagiumFile[],
  flush: (trackIds?: string[]) => TagiumFile[] = () => files,
): WorkflowOptions["editor"] => ({
  commands: {
    projectFiles: () => files,
    flush,
    preview: vi.fn(),
    uploadCover: vi.fn(),
    setCoverProcessing: vi.fn(),
    updateTags: vi.fn(async () => undefined),
    hydrateDownloadedTrack: vi.fn(() => Effect.void),
  },
  form: { subscribe: vi.fn(() => () => undefined) },
});
const fakeImporting = (
  importSharedContent = mocks.importSharedContent,
): WorkflowOptions["importing"] => ({
  commands: {
    upload: vi.fn(async () => undefined),
    importUrl: vi.fn(async () => undefined),
    retryTrack: vi.fn(),
    cancelQueue: vi.fn(),
    retryQueue: vi.fn(),
    removeTracks: vi.fn(),
    importSharedContent,
  },
});

const slug = "k7m4q2";
const analyticsId = "a".repeat(43);
type ShareHistoryState = { shareSlug?: string };
type ShareHistory = {
  state: ShareHistoryState;
  replaceState: (state: ShareHistoryState, title: string, path: string) => void;
  back: ReturnType<typeof vi.fn>;
};
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

const fakeLibraryStore = (
  albums: AlbumGroup[],
  files: TagiumFile[],
  dispatch: LibraryStore["dispatch"],
): LibraryStore => {
  const state = { ...createLibraryState(), albums, files };
  return { state, getSnapshot: () => state, dispatch };
};

const workflow = (albums: Array<{ id: string; sourceManifestSlug?: string }> = []) => {
  const events: string[] = [];
  const albumGroups = albums.map(({ id, sourceManifestSlug }) => ({
    id,
    title: "",
    artist: "",
    genre: "",
    trackIds: [],
    sourceManifestSlug,
  }));
  const library = fakeLibraryStore(
    albumGroups,
    [],
    vi.fn(() => events.push("select")),
  );
  const flush = vi.fn(() => {
    events.push("flush");
    return [];
  });
  const editor = fakeEditor([], flush);
  const importing = fakeImporting();
  const hook = renderHook(
    () =>
      useShareWorkflow({
        library,
        editor,
        importing,
        enabled: true,
      }),
    undefined,
  );
  return { hook, library, editor, events };
};

const creatorWorkflow = (album: AlbumGroup, file: TagiumFile) => {
  const albums = [album];
  const files = [file];
  const library = fakeLibraryStore(
    albums,
    files,
    vi.fn((action) => {
      if (action.type === "album-share-publication-set" && action.albumId === album.id) {
        album.sharePublication = action.publication;
      }
    }),
  );
  const hook = renderHook(
    () =>
      useShareWorkflow({
        library,
        editor: fakeEditor(files),
        importing: fakeImporting(vi.fn()),
        enabled: true,
      }),
    undefined,
  );
  return { hook, library };
};

const trackCreatorWorkflow = (file: TagiumFile, albums: AlbumGroup[] = [], flush = vi.fn()) => {
  const files = [file];
  const library = fakeLibraryStore(
    albums,
    files,
    vi.fn((action) => {
      if (action.type === "track-share-publication-set" && action.fileId === file.id) {
        file.sharePublication = action.publication;
      }
    }),
  );
  const hook = renderHook(
    () =>
      useShareWorkflow({
        library,
        editor: fakeEditor(files, flush),
        importing: fakeImporting(vi.fn()),
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
    audioFormat: "mp3",
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
  const location = { pathname: "/", origin: "https://tagium.app" };
  const fakeHistory: ShareHistory = {
    state: {},
    replaceState: (state: ShareHistoryState, _title: string, path: string) => {
      fakeHistory.state = state;
      location.pathname = path;
    },
    back: vi.fn(),
  };
  vi.stubGlobal("location", location);
  vi.stubGlobal("history", fakeHistory);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", { title: "tagium" });
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
    expect(mocks.fetchSharedContent).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("imports a pasted link in place without changing browser history, and ignores a concurrent submit", async () => {
    const { hook } = workflow();
    let resolveFetch:
      | ((value: {
          manifest: typeof sharedManifest;
          expiresAt: string;
          analyticsId: string;
        }) => void)
      | undefined;
    const pending = new Promise<{
      manifest: typeof sharedManifest;
      expiresAt: string;
      analyticsId: string;
    }>((resolve) => {
      resolveFetch = resolve;
    });
    mocks.fetchSharedContent.mockReturnValue(pending);
    const before = location.pathname;

    const first = hook.result.importFromInput(slug);
    const second = hook.result.importFromInput(slug);
    resolveFetch?.({
      manifest: sharedManifest,
      expiresAt: "2026-10-20T12:00:00.000Z",
      analyticsId,
    });
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(location.pathname).toBe(before);
    expect(mocks.fetchSharedContent).toHaveBeenCalledOnce();
    expect(mocks.importSharedContent).toHaveBeenCalledWith(sharedManifest, slug, undefined);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("album added to your library", {
      description: "downloading 1 track — watch progress in the sidebar.",
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith(expect.stringContaining("at a time"));
    expect(mocks.capture).toHaveBeenCalledWith({
      type: "share_added",
      shareId: analyticsId,
      shareKind: "album",
      trackCount: 1,
    });
    hook.unmount();
  });

  it("keeps a direct share route as a preview until its explicit add action", async () => {
    history.replaceState({}, "", `/share/${slug}`);
    mocks.fetchSharedContent.mockResolvedValue({
      manifest: sharedManifest,
      expiresAt: "2026-10-20T12:00:00.000Z",
      analyticsId,
    });
    const { hook } = workflow();

    await vi.waitFor(() => expect(hook.result.page).toMatchObject({ status: "ready", slug }));
    expect(mocks.importSharedContent).not.toHaveBeenCalled();
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith({
      type: "share_opened",
      shareId: analyticsId,
      shareKind: "album",
      trackCount: 1,
      viewer: "recipient",
    });
    await act(async () => hook.result.addSharedContent());

    expect(mocks.importSharedContent).toHaveBeenCalledWith(sharedManifest, slug, undefined);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("album added to your library", {
      description: "downloading 1 track — watch progress in the sidebar.",
    });
    expect(mocks.capture).toHaveBeenNthCalledWith(2, {
      type: "share_added",
      shareId: analyticsId,
      shareKind: "album",
      trackCount: 1,
    });
    hook.unmount();
  });

  it("imports artwork from the fresh manifest fetched by the add action", async () => {
    history.replaceState({}, "", `/share/${slug}`);
    const freshManifest = {
      ...sharedManifest,
      album: {
        ...sharedManifest.album,
        artwork: {
          kind: "stored" as const,
          format: "image/png" as const,
          type: 3,
          description: "fresh artwork",
        },
      },
    };
    const artworkFile = new File(["artwork"], "fresh.png", { type: "image/png" });
    const convertedPicture = [
      {
        format: "image/jpeg",
        type: 0,
        description: "converted",
        data: new Uint8Array([1, 2, 3]),
      },
    ];
    mocks.fetchSharedContent
      .mockResolvedValueOnce({
        manifest: sharedManifest,
        expiresAt: "2026-10-20T12:00:00.000Z",
        analyticsId,
      })
      .mockResolvedValueOnce({
        manifest: freshManifest,
        expiresAt: "2026-10-20T12:00:00.000Z",
        analyticsId,
      });
    mocks.fetchSharedArtwork.mockResolvedValue(artworkFile);
    mocks.coverArtFileToPicture.mockResolvedValue(convertedPicture);
    const { hook } = workflow();

    await vi.waitFor(() => expect(hook.result.page).toMatchObject({ status: "ready", slug }));
    await act(async () => hook.result.addSharedContent());

    expect(mocks.fetchSharedArtwork).toHaveBeenCalledOnce();
    expect(mocks.coverArtFileToPicture).toHaveBeenCalledWith(artworkFile, "shared artwork");
    expect(mocks.importSharedContent).toHaveBeenCalledWith(freshManifest, slug, [
      {
        ...convertedPicture[0],
        format: "image/png",
        type: 3,
        description: "fresh artwork",
      },
    ]);
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
    mocks.publishShare.mockResolvedValue({
      slug: "new-share",
      url: "https://tagium.app/share/new-share",
      expiresAt: "2031-01-01T00:00:00.000Z",
      revocationToken: "new-token",
      analyticsId,
    });

    await act(async () => hook.result.openCreator({ kind: "album", id: album.id }));
    expect(hook.result.dialog).toMatchObject({ status: "confirm", intent: "create" });
    await act(async () => hook.result.publish());

    expect(mocks.publishShare).toHaveBeenCalledOnce();
    expect(mocks.updateShare).not.toHaveBeenCalled();
    expect(album.sharePublication).toMatchObject({
      slug: "new-share",
      status: "active",
    });
    expect(mocks.capture).toHaveBeenCalledWith({
      type: "share_created",
      shareId: analyticsId,
      shareKind: "album",
      trackCount: 1,
      contentTitle: "Shared",
    });
    hook.unmount();
  });

  it("surfaces a recovery message if view-link permission disappears", async () => {
    const album = creatorAlbum({ ...oldPublication });
    album.sharePublication!.publishedFingerprint = (
      await projectAlbumShareSnapshot(album, [creatorFile])
    ).fingerprint;
    let opening = false;
    let openCapabilityReads = 0;
    mocks.getRevocationReceipt.mockImplementation(() => {
      if (!opening) return capability;
      openCapabilityReads += 1;
      return openCapabilityReads === 1 ? capability : null;
    });
    const { hook } = creatorWorkflow(album, creatorFile);
    await vi.waitFor(() =>
      expect(hook.result.shareActions[album.id]?.label).toBe("view share link"),
    );

    opening = true;
    await act(async () => hook.result.openCreator({ kind: "album", id: album.id }));

    expect(hook.result.dialog).toEqual({ status: "closed" });
    expect(mocks.toastError).toHaveBeenCalledWith("share link permission unavailable", {
      description: "try the browser that created this link",
    });
    hook.unmount();
  });

  it("records a successful update under the existing share ID", async () => {
    const album = creatorAlbum(oldPublication);
    album.title = "  Updated title  ";
    mocks.getRevocationReceipt.mockReturnValue(capability);
    mocks.updateShare.mockResolvedValue({
      slug: oldPublication.slug,
      url: oldPublication.url,
      expiresAt: oldPublication.expiresAt,
      analyticsId,
    });
    const { hook } = creatorWorkflow(album, creatorFile);

    await act(async () => hook.result.openCreator({ kind: "album", id: album.id }));
    expect(hook.result.dialog).toMatchObject({ status: "confirm", intent: "update" });
    await act(async () => hook.result.publish());

    expect(mocks.capture).toHaveBeenCalledWith({
      type: "share_updated",
      shareId: analyticsId,
      shareKind: "album",
      trackCount: 1,
      contentTitle: "Updated title",
    });
    expect(mocks.updateShare.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.capture.mock.invocationCallOrder[0]!,
    );
    expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain(oldPublication.slug);
    expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain(capability.token);
    hook.unmount();
  });

  it("creates an independent track publication from the track action menu", async () => {
    const file: TagiumFile = structuredClone(creatorFile);
    const { hook } = trackCreatorWorkflow(file);
    mocks.publishShare.mockResolvedValue({
      slug: "track-share",
      url: "https://tagium.app/share/track-share",
      expiresAt: "2031-01-01T00:00:00.000Z",
      revocationToken: "track-token",
      analyticsId,
    });

    expect(hook.result.shareTrackActions[file.id]).toMatchObject({
      enabled: true,
      label: "share track",
      variant: "create",
    });
    await act(async () => hook.result.openCreator({ kind: "track", id: file.id }));
    expect(hook.result.dialog).toMatchObject({
      status: "confirm",
      intent: "create",
      preview: { kind: "track", title: "One" },
    });
    await act(async () => hook.result.publish());

    expect(mocks.publishShare).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "track" }),
      null,
    );
    expect(file.sharePublication).toMatchObject({ slug: "track-share", status: "active" });
    expect(mocks.capture).toHaveBeenCalledWith({
      type: "share_created",
      shareId: analyticsId,
      shareKind: "track",
      trackCount: 1,
      contentTitle: "One",
    });
    hook.unmount();
  });

  it("reopens the source link instead of republishing a received track", async () => {
    const file: TagiumFile = { ...structuredClone(creatorFile), sourceManifestSlug: slug };
    const { hook } = trackCreatorWorkflow(file);

    expect(hook.result.shareTrackActions[file.id]).toMatchObject({
      label: "view share link",
      variant: "view",
    });
    await act(async () => hook.result.openCreator({ kind: "track", id: file.id }));
    expect(hook.result.dialog).toMatchObject({
      status: "link",
      url: `https://tagium.app/share/${slug}`,
      preview: { kind: "track", title: "One" },
    });
    expect(mocks.publishShare).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("keeps a local track shareable after it moves into a received album", async () => {
    const file: TagiumFile = structuredClone(creatorFile);
    const receivedAlbum: AlbumGroup = {
      ...creatorAlbum(),
      sourceManifestSlug: "received-album",
    };
    const { hook } = trackCreatorWorkflow(file, [receivedAlbum]);

    expect(hook.result.shareTrackActions[file.id]).toMatchObject({
      enabled: true,
      label: "share track",
      variant: "create",
    });
    await act(async () => hook.result.openCreator({ kind: "track", id: file.id }));
    expect(hook.result.dialog).toMatchObject({ status: "confirm", intent: "create" });
    hook.unmount();
  });

  it("reports oversized track metadata instead of rejecting the menu action", async () => {
    const file: TagiumFile = {
      ...structuredClone(creatorFile),
      pendingMetadataPatch: { title: "x".repeat(1_025) },
    };
    const { hook } = trackCreatorWorkflow(file);

    await expect(
      act(async () => hook.result.openCreator({ kind: "track", id: file.id })),
    ).resolves.toBeUndefined();
    expect(hook.result.dialog).toEqual({ status: "closed" });
    expect(mocks.toastError).toHaveBeenCalledWith("this track cannot be shared", {
      description: "this track contains too much metadata to share.",
    });
    hook.unmount();
  });
});
