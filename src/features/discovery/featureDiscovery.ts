import { useSyncExternalStore } from "react";
import { Schema } from "effect";

export const DISCOVERABLE_FEATURES = ["share-links"] as const;

export type DiscoverableFeature = (typeof DISCOVERABLE_FEATURES)[number];

export const FEATURE_DISCOVERY_STORAGE_KEY = "tagium:feature-discovery";

const decodeSeenFlags = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean));

const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const loadSeenFlags = (storage?: Pick<Storage, "getItem">) => {
  try {
    const stored = (storage ?? localStorage).getItem(FEATURE_DISCOVERY_STORAGE_KEY);
    return stored === null ? {} : decodeSeenFlags(JSON.parse(stored));
  } catch {
    return {};
  }
};

export const hasSeenFeature = (feature: DiscoverableFeature, storage?: Pick<Storage, "getItem">) =>
  loadSeenFlags(storage)[feature] === true;

export const setFeatureSeen = (
  feature: DiscoverableFeature,
  seen: boolean,
  storage?: Pick<Storage, "getItem" | "setItem">,
) => {
  try {
    const { [feature]: _previous, ...others } = loadSeenFlags(storage);
    (storage ?? localStorage).setItem(
      FEATURE_DISCOVERY_STORAGE_KEY,
      JSON.stringify(seen ? { ...others, [feature]: true } : others),
    );
  } catch {
    return;
  }
  notify();
};

export const markFeatureSeen = (
  feature: DiscoverableFeature,
  storage?: Pick<Storage, "getItem" | "setItem">,
) => setFeatureSeen(feature, true, storage);

export const resetFeatureDiscovery = (storage?: Pick<Storage, "removeItem">) => {
  try {
    (storage ?? localStorage).removeItem(FEATURE_DISCOVERY_STORAGE_KEY);
  } catch {
    return;
  }
  notify();
};

const subscribe = (listener: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === FEATURE_DISCOVERY_STORAGE_KEY) listener();
  };
  listeners.add(listener);
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("storage", onStorage);
  };
};

export const useFeatureDiscovery = (
  feature: DiscoverableFeature,
  storage?: Pick<Storage, "getItem" | "setItem">,
) => {
  const seen = useSyncExternalStore(subscribe, () => hasSeenFeature(feature, storage));

  return {
    seen,
    markSeen: () => markFeatureSeen(feature, storage),
    setSeen: (nextSeen: boolean) => setFeatureSeen(feature, nextSeen, storage),
  };
};
