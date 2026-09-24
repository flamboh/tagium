import { useState } from "react";
import { Schema } from "effect";

export type DiscoverableFeature = "share-links";

export const FEATURE_DISCOVERY_STORAGE_KEY = "tagium:feature-discovery";

const decodeSeenFlags = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean));

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

export const markFeatureSeen = (
  feature: DiscoverableFeature,
  storage?: Pick<Storage, "getItem" | "setItem">,
) => {
  try {
    (storage ?? localStorage).setItem(
      FEATURE_DISCOVERY_STORAGE_KEY,
      JSON.stringify({ ...loadSeenFlags(storage), [feature]: true }),
    );
  } catch {
    return;
  }
};

export const useFeatureDiscovery = (
  feature: DiscoverableFeature,
  storage?: Pick<Storage, "getItem" | "setItem">,
) => {
  const [seen, setSeen] = useState(() => hasSeenFeature(feature, storage));

  return {
    seen,
    markSeen: () => {
      markFeatureSeen(feature, storage);
      setSeen(true);
    },
  };
};
