import type { UniqueIdentifier } from "@dnd-kit/core";
import { albumIdFromDrop, LOOSE_APPEND_CONTAINER_ID } from "@/features/library/sidebarDnd";
import type { SidebarDragData, SidebarDropData } from "@/features/library/sidebarDnd";
import type { AlbumGroup } from "@/features/library/types";

export type TrackPlacement = "before" | "after" | "append";

export type SidebarDragCommand =
  | { type: "reorder-album"; albumId: string; targetIndex: number }
  | {
      type: "move-track-to-album";
      trackId: string;
      albumId: string;
      placement: TrackPlacement;
      referenceTrackId?: string;
    }
  | {
      type: "move-track-to-loose";
      trackId: string;
      placement: TrackPlacement;
      referenceTrackId?: string;
    }
  | { type: "create-album-from-loose-tracks"; sourceTrackId: string; targetTrackId: string };

export interface SidebarDropPosition {
  deltaY: number;
  overId: UniqueIdentifier;
  overRect: { top: number; height: number } | null;
}

export interface RecentLooseTarget {
  trackId: string;
  expiresAt: number;
}

interface ResolveSidebarDragCommandOptions {
  active: SidebarDragData;
  over: SidebarDropData;
  position: SidebarDropPosition;
  albums: Pick<AlbumGroup, "id" | "trackIds">[];
  looseTrackIds: string[];
  dragStartY: number | null;
  recentLooseTarget: RecentLooseTarget | null;
  now: number;
}

const rowPlacement = (
  position: SidebarDropPosition,
  sourceTrackId: string,
  targetTrackId: string,
  trackIds: string[],
  initialY: number | null,
): Exclude<TrackPlacement, "append"> => {
  if (!position.overRect) return "after";
  if (initialY === null) {
    const sourceIndex = trackIds.indexOf(sourceTrackId);
    const targetIndex = trackIds.indexOf(targetTrackId);
    if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex > targetIndex) return "before";
    if (sourceIndex < 0) return "before";
    return "after";
  }

  const y = initialY + position.deltaY;
  return y > position.overRect.top + position.overRect.height / 2 ? "after" : "before";
};

const isCenteredLooseDrop = (position: SidebarDropPosition, initialY: number | null) => {
  if (!position.overRect || initialY === null) return false;
  const y = initialY + position.deltaY;
  const relativePosition = (y - position.overRect.top) / position.overRect.height;
  return relativePosition > 0.3 && relativePosition < 0.7;
};

const trackIdsForDrop = (
  drop: Extract<SidebarDropData, { type: "track" }>,
  albums: Pick<AlbumGroup, "id" | "trackIds">[],
  looseTrackIds: string[],
) => {
  if (drop.container === "loose") return looseTrackIds;
  return albums.find((album) => album.id === drop.albumId)?.trackIds ?? [];
};

export const resolveSidebarDragCommand = ({
  active,
  over,
  position,
  albums,
  looseTrackIds,
  dragStartY,
  recentLooseTarget,
  now,
}: ResolveSidebarDragCommandOptions): SidebarDragCommand | null => {
  if (active.type === "album") {
    const targetAlbumId = albumIdFromDrop(over);
    if (!targetAlbumId || targetAlbumId === active.albumId) return null;

    const sourceIndex = albums.findIndex((album) => album.id === active.albumId);
    const targetIndex = albums.findIndex((album) => album.id === targetAlbumId);
    if (sourceIndex < 0 || targetIndex < 0) return null;
    return { type: "reorder-album", albumId: active.albumId, targetIndex };
  }

  if (over.type === "track") {
    if (over.trackId === active.trackId) return null;

    const placement = rowPlacement(
      position,
      active.trackId,
      over.trackId,
      trackIdsForDrop(over, albums, looseTrackIds),
      dragStartY,
    );
    if (over.container === "loose") {
      if (active.container === "loose" && isCenteredLooseDrop(position, dragStartY)) {
        return {
          type: "create-album-from-loose-tracks",
          sourceTrackId: active.trackId,
          targetTrackId: over.trackId,
        };
      }
      return {
        type: "move-track-to-loose",
        trackId: active.trackId,
        placement,
        referenceTrackId: over.trackId,
      };
    }

    return {
      type: "move-track-to-album",
      trackId: active.trackId,
      albumId: over.albumId,
      placement,
      referenceTrackId: over.trackId,
    };
  }

  if (over.type === "album" || (over.type === "container" && over.container === "album")) {
    return {
      type: "move-track-to-album",
      trackId: active.trackId,
      albumId: over.albumId,
      placement: "append",
    };
  }

  if (
    active.container === "loose" &&
    position.overId !== LOOSE_APPEND_CONTAINER_ID &&
    recentLooseTarget &&
    recentLooseTarget.expiresAt > now
  ) {
    return {
      type: "create-album-from-loose-tracks",
      sourceTrackId: active.trackId,
      targetTrackId: recentLooseTarget.trackId,
    };
  }

  return { type: "move-track-to-loose", trackId: active.trackId, placement: "append" };
};
