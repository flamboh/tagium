import { describe, expect, it } from "vite-plus/test";
import type { ShareActionState } from "@/features/share/sharePublication";
import {
  SHARE_LINK_SPOTLIGHT_STORAGE_KEY,
  useShareLinkSpotlight,
} from "@/features/share/useShareLinkSpotlight";
import { renderHook } from "../../support/hookTestHarness";

const shareable: ShareActionState = {
  enabled: true,
  label: "share track",
  reason: "share track",
  variant: "create",
};
const unavailable: ShareActionState = {
  ...shareable,
  enabled: false,
  reason: "local tracks cannot be shared",
};
const viewOnly: ShareActionState = {
  enabled: true,
  label: "view share link",
  reason: "view share link",
  variant: "view",
};

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};

type SpotlightProps = Parameters<typeof useShareLinkSpotlight>[0];

const files = [{ id: "local" }, { id: "shared" }, { id: "imported" }, { id: "later" }];
const actions = { local: unavailable, shared: viewOnly, imported: shareable, later: shareable };

describe("share link spotlight", () => {
  it("targets the first track that can create a new share link", () => {
    const storage = memoryStorage();
    const hook = renderHook(useShareLinkSpotlight, {
      files,
      shareTrackActions: actions,
      visible: true,
      storage,
    });

    expect(hook.result.trackId).toBe("imported");
  });

  it("waits until an eligible track exists", () => {
    const storage = memoryStorage();
    const hook = renderHook(useShareLinkSpotlight, {
      files: [{ id: "local" }],
      shareTrackActions: { local: unavailable },
      visible: true,
      storage,
    });
    expect(hook.result.trackId).toBeNull();

    hook.rerender({ files, shareTrackActions: actions, visible: true, storage });
    expect(hook.result.trackId).toBe("imported");
  });

  it("stays hidden while the library is not visible or sharing is off", () => {
    const storage = memoryStorage();
    const hook = renderHook<SpotlightProps, ReturnType<typeof useShareLinkSpotlight>>(
      useShareLinkSpotlight,
      {
        files,
        shareTrackActions: actions,
        visible: false,
        storage,
      },
    );
    expect(hook.result.trackId).toBeNull();

    hook.rerender({ files, shareTrackActions: undefined, visible: true, storage });
    expect(hook.result.trackId).toBeNull();
  });

  it("remembers dismissal across sessions", () => {
    const storage = memoryStorage();
    const hook = renderHook(useShareLinkSpotlight, {
      files,
      shareTrackActions: actions,
      visible: true,
      storage,
    });

    hook.result.dismiss();
    hook.rerender({ files, shareTrackActions: actions, visible: true, storage });
    expect(hook.result.trackId).toBeNull();
    expect(storage.values.get(SHARE_LINK_SPOTLIGHT_STORAGE_KEY)).toBe("true");

    const nextSession = renderHook(useShareLinkSpotlight, {
      files,
      shareTrackActions: actions,
      visible: true,
      storage,
    });
    expect(nextSession.result.trackId).toBeNull();
  });
});
