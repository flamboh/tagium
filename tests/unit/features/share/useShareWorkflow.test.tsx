import { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AlbumGroup, TagiumFile } from "@/features/library/types";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import { useTrackEditorSession } from "@/features/editor/useTrackEditorSession";
import { useLibraryStore } from "@/features/library/useLibraryStore";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";

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
import { SharedContentUnavailableError } from "@/features/share/shareClient";
import {
  projectAlbumShareSnapshot,
  projectTrackShareSnapshot,
} from "@/features/share/sharePublication";

const slug = "k7m4q2";
const analyticsId = "a".repeat(43);
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
    state: { albums, files: [] },
    getSnapshot: () => ({ albums, files: [] }),
    dispatch: vi.fn(() => events.push("select")),
  } as unknown as LibraryStore;
  const editor = {
    commands: { flush: vi.fn(() => events.push("flush")), projectFiles: () => [] },
    form: { subscribe: () => () => undefined },
  };
  const importing = { commands: { importSharedContent: mocks.importSharedContent } };
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
        editor: {
          commands: { flush: vi.fn(), projectFiles: () => files },
          form: { subscribe: () => () => undefined },
        } as never,
        importing: { commands: { importSharedContent: vi.fn() } } as never,
        enabled: true,
      }),
    undefined,
  );
  return { hook, library };
};

const trackCreatorWorkflow = (file: TagiumFile, albums: AlbumGroup[] = [], flush = vi.fn()) => {
  const files = [file];
  const library = {
    state: { albums, files },
    getSnapshot: () => ({ albums, files }),
    dispatch: vi.fn((action: { type: string; fileId?: string; publication?: unknown }) => {
      if (action.type === "track-share-publication-set" && action.fileId === file.id) {
        file.sharePublication = action.publication as TagiumFile["sharePublication"];
      }
    }),
  } as unknown as LibraryStore;
  const hook = renderHook(
    () =>
      useShareWorkflow({
        library,
        editor: {
          commands: { flush, projectFiles: () => files },
          form: { subscribe: () => () => undefined },
        } as never,
        importing: { commands: { importSharedContent: vi.fn() } } as never,
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
  const location = { pathname: "/", origin: "https://tagium.app" };
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
    hook.unmount();
  });

  it("reports download progress after adding from a share preview", async () => {
    history.replaceState({}, "", `/share/${slug}`);
    mocks.fetchSharedContent.mockResolvedValue({
      manifest: sharedManifest,
      expiresAt: "2026-10-20T12:00:00.000Z",
      analyticsId,
    });
    const { hook } = workflow();

    await vi.waitFor(() => expect(hook.result.page).toMatchObject({ status: "ready", slug }));
    await act(async () => hook.result.addSharedContent());

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
    const artworkFile = { name: "fresh.png", type: "image/png" } as File;
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

  it("rejects pasted links safely when sharing is disabled", async () => {
    const library = {
      state: { albums: [], files: [] },
      getSnapshot: () => ({ albums: [], files: [] }),
      dispatch: vi.fn(),
    } as unknown as LibraryStore;
    const hook = renderHook(
      () =>
        useShareWorkflow({
          library,
          editor: {
            commands: { flush: vi.fn(), projectFiles: () => [] },
            form: { subscribe: () => () => undefined },
          } as never,
          importing: { commands: { importSharedContent: vi.fn() } } as never,
          enabled: false,
        }),
      undefined,
    );

    await expect(hook.result.importFromInput(slug)).rejects.toBeInstanceOf(
      SharedContentUnavailableError,
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

  it("explains that a failed create did not produce a link", async () => {
    const album = creatorAlbum();
    mocks.publishShare.mockRejectedValue(new Error("sharing is unavailable"));
    const { hook } = creatorWorkflow(album, creatorFile);

    await act(async () => hook.result.openCreator({ kind: "album", id: album.id }));
    await act(async () => hook.result.publish());

    await vi.waitFor(() =>
      expect(hook.result.dialog).toMatchObject({
        status: "error",
        intent: "create",
        message: "the share link could not be created.",
      }),
    );
    expect(mocks.capture).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("explains that a failed update left the previous link version intact", async () => {
    const album = creatorAlbum(oldPublication);
    mocks.getRevocationReceipt.mockReturnValue(capability);
    mocks.updateShare.mockRejectedValue(new Error("offline"));
    const { hook } = creatorWorkflow(album, creatorFile);

    await act(async () => hook.result.openCreator({ kind: "album", id: album.id }));
    expect(hook.result.dialog).toMatchObject({ status: "confirm", intent: "update" });
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
    hook.unmount();
  });

  it("flushes an unpreviewed track edit before choosing update versus view", async () => {
    const file: TagiumFile = structuredClone(creatorFile);
    const published = await projectTrackShareSnapshot(file);
    file.sharePublication = {
      slug: oldPublication.slug,
      url: oldPublication.url,
      expiresAt: oldPublication.expiresAt,
      publishedFingerprint: published.fingerprint,
      status: "active",
    };
    mocks.getRevocationReceipt.mockReturnValue(capability);
    const flush = vi.fn(() => {
      file.pendingMetadataPatch = { genre: "Ambient" };
    });
    const { hook } = trackCreatorWorkflow(file, [], flush);

    await vi.waitFor(() =>
      expect(hook.result.shareTrackActions[file.id]?.label).toBe("view share link"),
    );
    await act(async () => hook.result.openCreator({ kind: "track", id: file.id }));

    expect(flush).toHaveBeenCalledOnce();
    expect(hook.result.dialog).toMatchObject({
      status: "confirm",
      intent: "update",
      preview: { kind: "track" },
    });
    expect(file.pendingMetadataPatch).toEqual({ genre: "Ambient" });
    hook.unmount();
  });

  it.each([
    ["year", "2026"],
    ["genre", "Ambient"],
    ["trackNumber", "2"],
  ] as const)("offers an update after a %s-only form edit", async (field, value) => {
    const file: TagiumFile = structuredClone(creatorFile);
    const published = await projectTrackShareSnapshot(file);
    file.sharePublication = {
      slug: oldPublication.slug,
      url: oldPublication.url,
      expiresAt: oldPublication.expiresAt,
      publishedFingerprint: published.fingerprint,
      status: "active",
    };
    mocks.getRevocationReceipt.mockReturnValue(capability);
    const hook = renderHook(() => {
      const library = useLibraryStore();
      const editor = useTrackEditorSession({
        library,
        settings: {
          ...DEFAULT_APP_SETTINGS,
          syncFilenames: false,
          syncTrackNumbers: false,
          metadataLinks: { ...DEFAULT_APP_SETTINGS.metadataLinks, singleAlbum: false },
        },
      });
      const sharing = useShareWorkflow({
        library,
        editor,
        importing: { commands: { importSharedContent: vi.fn() } } as never,
        enabled: true,
      });
      return { editor, library, sharing };
    }, undefined);
    act(() => {
      hook.result.library.dispatch({
        type: "content-replaced",
        files: [file],
        looseTrackIds: [file.id],
        selection: { selectedAlbumId: null, selectedFileId: file.id },
      });
    });
    await vi.waitFor(() =>
      expect(hook.result.sharing.shareTrackActions[file.id]?.label).toBe("view share link"),
    );

    const registration = hook.result.editor.form.register(
      field,
      field === "genre" ? {} : { valueAsNumber: true },
    );
    const target = {
      name: field,
      value,
      ...(field === "genre" ? {} : { type: "number", valueAsNumber: Number(value) }),
    };
    act(() => {
      if (field !== "genre") {
        registration.ref(target as HTMLInputElement);
        target.value = value;
        target.valueAsNumber = Number(value);
      }
      void registration.onChange({ target, type: "change" });
    });
    expect(hook.result.editor.form.getValues(field)).toBe(
      field === "genre" ? value : Number(value),
    );

    await vi.waitFor(() =>
      expect(hook.result.sharing.shareTrackActions[file.id]?.label).toBe("update shared track"),
    );
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
