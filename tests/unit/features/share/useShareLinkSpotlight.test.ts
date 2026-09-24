import { describe, expect, it } from "vite-plus/test";
import {
  FEATURE_DISCOVERY_STORAGE_KEY,
  markFeatureSeen,
} from "@/features/discovery/featureDiscovery";
import type { ShareActionState } from "@/features/share/sharePublication";
import {
  shareLinkSpotlightCopy,
  useShareLinkSpotlight,
} from "@/features/share/useShareLinkSpotlight";
import { renderHook } from "../../support/hookTestHarness";

const canCreate = (label: ShareActionState["label"]): ShareActionState => ({
  enabled: true,
  label,
  reason: label,
  variant: "create",
});
const unavailable = (label: ShareActionState["label"]): ShareActionState => ({
  ...canCreate(label),
  enabled: false,
  reason: "unavailable",
});
const viewOnly: ShareActionState = {
  enabled: true,
  label: "view share link",
  reason: "view share link",
  variant: "view",
};

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};

type SpotlightProps = Parameters<typeof useShareLinkSpotlight>[0];

const props = (overrides: Partial<SpotlightProps> = {}): SpotlightProps => ({
  albums: [{ id: "shared-album" }, { id: "local-album" }, { id: "playlist" }],
  files: [
    { id: "local", downloadStatus: "ready" },
    { id: "imported", downloadStatus: "ready" },
  ],
  shareAlbumActions: {
    "shared-album": viewOnly,
    "local-album": unavailable("share album"),
    playlist: canCreate("share album"),
  },
  shareTrackActions: { local: unavailable("share track"), imported: canCreate("share track") },
  visible: true,
  storage: memoryStorage(),
  ...overrides,
});

describe("share link spotlight", () => {
  it("prefers a shareable album over a shareable track", () => {
    const hook = renderHook(useShareLinkSpotlight, props());
    expect(hook.result.target).toEqual({ kind: "album", id: "playlist" });
  });

  it("falls back to the first shareable track", () => {
    const hook = renderHook(
      useShareLinkSpotlight,
      props({ shareAlbumActions: { playlist: unavailable("share album") } }),
    );
    expect(hook.result.target).toEqual({ kind: "track", id: "imported" });
  });

  it("waits until something can be shared", () => {
    const storage = memoryStorage();
    const hook = renderHook(
      useShareLinkSpotlight,
      props({ albums: [], files: [{ id: "local", downloadStatus: "ready" }], storage }),
    );
    expect(hook.result.target).toBeNull();

    hook.rerender(props({ storage }));
    expect(hook.result.target).toEqual({ kind: "album", id: "playlist" });
  });

  it("waits for running imports to settle before pointing anywhere", () => {
    const storage = memoryStorage();
    const hook = renderHook(
      useShareLinkSpotlight,
      props({
        files: [
          { id: "local", downloadStatus: "ready" },
          { id: "imported", downloadStatus: "ready" },
          { id: "queued", downloadStatus: "downloading" },
        ],
        storage,
      }),
    );
    expect(hook.result.target).toBeNull();

    hook.rerender(
      props({
        albums: [{ id: "playlist", coverPending: true }],
        shareAlbumActions: { playlist: unavailable("share album") },
        storage,
      }),
    );
    expect(hook.result.target).toBeNull();

    hook.rerender(props({ storage }));
    expect(hook.result.target).toEqual({ kind: "album", id: "playlist" });
  });

  it("stays hidden while the library is not visible or sharing is off", () => {
    const storage = memoryStorage();
    const hook = renderHook(useShareLinkSpotlight, props({ visible: false, storage }));
    expect(hook.result.target).toBeNull();

    hook.rerender(props({ shareAlbumActions: undefined, shareTrackActions: undefined, storage }));
    expect(hook.result.target).toBeNull();
  });

  it("shares one seen flag across albums and tracks", () => {
    const storage = memoryStorage();
    const hook = renderHook(useShareLinkSpotlight, props({ storage }));

    hook.result.dismiss();
    hook.rerender(props({ storage, shareAlbumActions: {} }));
    expect(hook.result.target).toBeNull();
    expect(storage.values.get(FEATURE_DISCOVERY_STORAGE_KEY)).toBe('{"share-links":true}');
  });

  it("starts hidden once share links were already discovered", () => {
    const storage = memoryStorage();
    markFeatureSeen("share-links", storage);
    const hook = renderHook(useShareLinkSpotlight, props({ storage }));
    expect(hook.result.target).toBeNull();
  });

  it("describes what the recipient gets for each kind", () => {
    expect(shareLinkSpotlightCopy("album").description).toBe(
      "anyone with the link gets this album with your tags and artwork.",
    );
    expect(shareLinkSpotlightCopy("track").description).toBe(
      "anyone with the link gets this track with your tags and artwork.",
    );
  });
});
