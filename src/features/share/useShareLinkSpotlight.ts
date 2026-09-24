import type { AlbumGroup, TagiumFile } from "@/features/library/types";
import { useFeatureDiscovery } from "@/features/discovery/featureDiscovery";
import type { ShareActionState } from "@/features/share/sharePublication";

export type ShareLinkSpotlightTarget = { kind: "album" | "track"; id: string };

type ShareActions = Readonly<Record<string, ShareActionState>>;

const canCreateShare = (action: ShareActionState | undefined) =>
  action?.enabled === true && action.variant === "create";

export const shareLinkSpotlightTarget = ({
  albums,
  files,
  shareAlbumActions,
  shareTrackActions,
}: {
  albums: readonly Pick<AlbumGroup, "id" | "coverPending">[];
  files: readonly Pick<TagiumFile, "id" | "downloadStatus">[];
  shareAlbumActions: ShareActions;
  shareTrackActions: ShareActions;
}): ShareLinkSpotlightTarget | null => {
  const importing =
    files.some((file) => file.downloadStatus === "downloading") ||
    albums.some((album) => album.coverPending);
  if (importing) return null;
  const album = albums.find((candidate) => canCreateShare(shareAlbumActions[candidate.id]));
  if (album) return { kind: "album", id: album.id };
  const file = files.find((candidate) => canCreateShare(shareTrackActions[candidate.id]));
  return file ? { kind: "track", id: file.id } : null;
};

export const shareLinkSpotlightCopy = (kind: ShareLinkSpotlightTarget["kind"]) => ({
  title: "share your edits with a link",
  description: `anyone with the link gets this ${kind} with your tags and artwork.`,
});

export const useShareLinkSpotlight = ({
  albums,
  files,
  shareAlbumActions,
  shareTrackActions,
  visible,
  storage,
}: {
  albums: readonly Pick<AlbumGroup, "id" | "coverPending">[];
  files: readonly Pick<TagiumFile, "id" | "downloadStatus">[];
  shareAlbumActions: ShareActions | undefined;
  shareTrackActions: ShareActions | undefined;
  visible: boolean;
  storage?: Pick<Storage, "getItem" | "setItem">;
}) => {
  const discovery = useFeatureDiscovery("share-links", storage);
  const target =
    visible && !discovery.seen && shareAlbumActions && shareTrackActions
      ? shareLinkSpotlightTarget({ albums, files, shareAlbumActions, shareTrackActions })
      : null;

  return { target, dismiss: discovery.markSeen };
};
