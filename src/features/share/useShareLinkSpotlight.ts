import { useState } from "react";
import type { TagiumFile } from "@/features/library/types";
import type { ShareActionState } from "@/features/share/sharePublication";

export const SHARE_LINK_SPOTLIGHT_STORAGE_KEY = "tagium:share-link-spotlight-seen";

const loadSeen = (storage?: Pick<Storage, "getItem">) => {
  try {
    return (storage ?? localStorage).getItem(SHARE_LINK_SPOTLIGHT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const storeSeen = (storage?: Pick<Storage, "setItem">) => {
  try {
    (storage ?? localStorage).setItem(SHARE_LINK_SPOTLIGHT_STORAGE_KEY, "true");
  } catch {
    return;
  }
};

const shareLinkSpotlightTrackId = (
  files: readonly Pick<TagiumFile, "id">[],
  shareTrackActions: Readonly<Record<string, ShareActionState>>,
) =>
  files.find((file) => {
    const action = shareTrackActions[file.id];
    return action?.enabled && action.variant === "create";
  })?.id ?? null;

export const useShareLinkSpotlight = ({
  files,
  shareTrackActions,
  visible,
  storage,
}: {
  files: readonly Pick<TagiumFile, "id">[];
  shareTrackActions: Readonly<Record<string, ShareActionState>> | undefined;
  visible: boolean;
  storage?: Pick<Storage, "getItem" | "setItem">;
}) => {
  const [seen, setSeen] = useState(() => loadSeen(storage));
  const trackId =
    visible && !seen && shareTrackActions
      ? shareLinkSpotlightTrackId(files, shareTrackActions)
      : null;

  return {
    trackId,
    dismiss: () => {
      storeSeen(storage);
      setSeen(true);
    },
  };
};
