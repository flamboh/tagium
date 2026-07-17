import {
  closestCorners,
  type Collision,
  type CollisionDetection,
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

const EMPTY_LOOSE_DROP_ZONE_HEIGHT = 24;

export const emptyLooseDropCollision = ({
  active,
  droppableContainers,
  droppableRects,
  pointerCoordinates,
}: Parameters<CollisionDetection>[0]): Collision[] | null => {
  const activeData = active.data.current as SidebarDragData | undefined;
  if (activeData?.type !== "track" || !pointerCoordinates) return null;

  const looseContainer = droppableContainers.find(({ id }) => id === LOOSE_CONTAINER_ID);
  const looseRect = droppableRects.get(LOOSE_CONTAINER_ID);
  if (!looseContainer || !looseRect) return null;

  const hasLooseTracks = droppableContainers.some(({ data }) => {
    const dropData = data.current as SidebarDropData | undefined;
    return dropData?.type === "track" && dropData.container === "loose";
  });
  if (hasLooseTracks) return null;

  const firstAlbumTop = droppableContainers.reduce<number | null>((top, container) => {
    const data = container.data.current as SidebarDropData | undefined;
    if (data?.type !== "album") return top;
    const rect = droppableRects.get(container.id);
    if (!rect) return top;
    return top === null ? rect.top : Math.min(top, rect.top);
  }, null);
  if (firstAlbumTop === null) return null;

  const isNearFirstAlbum =
    pointerCoordinates.y >= looseRect.top &&
    pointerCoordinates.y <= firstAlbumTop + EMPTY_LOOSE_DROP_ZONE_HEIGHT;
  return isNearFirstAlbum ? [{ id: looseContainer.id }] : null;
};

export const sidebarCollisionDetection: CollisionDetection = (args) => {
  const emptyLooseCollision = emptyLooseDropCollision(args);
  if (emptyLooseCollision) return emptyLooseCollision;

  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;

  const intersections = rectIntersection(args);
  if (intersections.length > 0) return intersections;

  return closestCorners(args);
};

export const albumIdFromDrop = (drop: SidebarDropData) => {
  if (drop.type === "album") return drop.albumId;
  if (drop.type === "track" && drop.container === "album") return drop.albumId;
  if (drop.type === "container" && drop.container === "album") return drop.albumId;
  return null;
};
