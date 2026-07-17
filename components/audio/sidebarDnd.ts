import {
  closestCorners,
  type CollisionDetection,
  type DragEndEvent,
  pointerWithin,
  rectIntersection,
} from "@dnd-kit/core";

export const LOOSE_CONTAINER_ID = "container:loose";
export const LOOSE_APPEND_CONTAINER_ID = "container:loose:append";

export type SidebarDragData =
  | { type: "album"; albumId: string }
  | { type: "track"; trackId: string; container: "album"; albumId: string }
  | { type: "track"; trackId: string; container: "loose" };

export type SidebarDropData =
  | SidebarDragData
  | { type: "container"; container: "loose" }
  | { type: "container"; container: "album"; albumId: string };

export const albumItemId = (albumId: string) => `album:${albumId}`;
export const albumContainerId = (albumId: string) => `container:album:${albumId}`;
export const trackItemId = (trackId: string) => `track:${trackId}`;

export const sidebarCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;

  const intersections = rectIntersection(args);
  if (intersections.length > 0) return intersections;

  return closestCorners(args);
};

export const dragStartY = (event: Event) => {
  const sourceEvent = event as Event & {
    changedTouches?: TouchList;
    clientY?: number;
    touches?: TouchList;
  };
  if (sourceEvent.clientY !== undefined) return sourceEvent.clientY;
  if (sourceEvent.touches?.[0]) return sourceEvent.touches[0].clientY;
  if (sourceEvent.changedTouches?.[0]) return sourceEvent.changedTouches[0].clientY;
  return null;
};

export const albumIdFromDrop = (drop: SidebarDropData) => {
  if (drop.type === "album") return drop.albumId;
  if (drop.type === "track" && drop.container === "album") return drop.albumId;
  if (drop.type === "container" && drop.container === "album") return drop.albumId;
  return null;
};

export const rowPlacement = (
  event: DragEndEvent,
  sourceTrackId: string,
  targetTrackId: string,
  trackIds: string[],
  initialY: number | null,
) => {
  const rect = event.over?.rect;
  if (!rect) return "after";
  if (initialY === null) {
    const sourceIndex = trackIds.indexOf(sourceTrackId);
    const targetIndex = trackIds.indexOf(targetTrackId);
    if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex > targetIndex) return "before";
    if (sourceIndex < 0) return "before";
    return "after";
  }

  const y = initialY + event.delta.y;
  return y > rect.top + rect.height / 2 ? "after" : "before";
};

export const isCenteredLooseDrop = (event: DragEndEvent, initialY: number | null) => {
  const rect = event.over?.rect;
  if (!rect) return false;
  if (initialY === null) return false;
  const y = initialY + event.delta.y;
  const position = (y - rect.top) / rect.height;
  return position > 0.3 && position < 0.7;
};
