import {
  closestCorners,
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

export const sidebarCollisionDetection: CollisionDetection = (args) => {
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
