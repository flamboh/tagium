"use client";

import {
  closestCorners,
  type Collision,
  type CollisionDetection,
  type DroppableContainer,
  pointerWithin,
  rectIntersection,
} from "@dnd-kit/core";
import type { SidebarDragData, SidebarDropData } from "./AlbumSidebarDnd";

type CollisionArgs = Parameters<CollisionDetection>[0];

const sidebarDropData = (container: DroppableContainer) =>
  container.data.current as SidebarDropData | undefined;

const collisionPriority = (collision: Collision, prioritizeCombine: boolean) => {
  const container = collision.data?.droppableContainer as DroppableContainer | undefined;
  const data = container ? sidebarDropData(container) : undefined;
  if (data?.type === "combine") return prioritizeCombine ? 0 : 4;
  if (data?.type === "track") return 1;
  if (data?.type === "album") return 2;
  if (data?.type === "container") return 3;
  return 3;
};

const collisionsForSidebar = (collisions: Collision[], prioritizeCombine: boolean) =>
  [...collisions].sort(
    (left, right) =>
      collisionPriority(left, prioritizeCombine) - collisionPriority(right, prioritizeCombine),
  );

const collisionArgsForSidebar = (args: CollisionArgs): CollisionArgs => {
  const active = args.active.data.current as SidebarDragData | undefined;
  if (active?.type !== "album") return args;

  return {
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => sidebarDropData(container)?.type === "album",
    ),
  };
};

export const sidebarCollisionDetection: CollisionDetection = (args) => {
  const sidebarArgs = collisionArgsForSidebar(args);
  const pointerCollisions = pointerWithin(sidebarArgs);
  if (pointerCollisions.length > 0) return collisionsForSidebar(pointerCollisions, true);

  const intersections = rectIntersection(sidebarArgs);
  if (intersections.length > 0) return collisionsForSidebar(intersections, false);

  return collisionsForSidebar(closestCorners(sidebarArgs), false);
};
