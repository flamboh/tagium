import { describe, expect, it } from "vite-plus/test";
import {
  FEATURE_DISCOVERY_STORAGE_KEY,
  hasSeenFeature,
  markFeatureSeen,
  useFeatureDiscovery,
} from "@/features/discovery/featureDiscovery";
import { renderHook } from "../../support/hookTestHarness";

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};

describe("feature discovery", () => {
  it("stores a seen flag per feature without dropping other flags", () => {
    const storage = memoryStorage({
      [FEATURE_DISCOVERY_STORAGE_KEY]: JSON.stringify({ "retired-feature": true }),
    });

    expect(hasSeenFeature("share-links", storage)).toBe(false);
    markFeatureSeen("share-links", storage);

    expect(hasSeenFeature("share-links", storage)).toBe(true);
    expect(JSON.parse(storage.values.get(FEATURE_DISCOVERY_STORAGE_KEY)!)).toEqual({
      "retired-feature": true,
      "share-links": true,
    });
  });

  it("treats unreadable storage as unseen", () => {
    const storage = memoryStorage({ [FEATURE_DISCOVERY_STORAGE_KEY]: "not json" });
    expect(hasSeenFeature("share-links", storage)).toBe(false);

    markFeatureSeen("share-links", storage);
    expect(hasSeenFeature("share-links", storage)).toBe(true);
  });

  it("marks a feature seen for this session and the next", () => {
    const storage = memoryStorage();
    const hook = renderHook(() => useFeatureDiscovery("share-links", storage), undefined);
    expect(hook.result.seen).toBe(false);

    hook.result.markSeen();
    hook.rerender(undefined);
    expect(hook.result.seen).toBe(true);

    const nextSession = renderHook(() => useFeatureDiscovery("share-links", storage), undefined);
    expect(nextSession.result.seen).toBe(true);
  });
});
