import { describe, expect, it } from "vite-plus/test";
import {
  resolveSidebarDragCommand,
  type SidebarDropPosition,
} from "@/features/library/sidebarDragController";
import {
  emptyLooseDropCollision,
  LOOSE_APPEND_CONTAINER_ID,
  LOOSE_CONTAINER_ID,
} from "@/features/library/sidebarDnd";

const albums = [
  { id: "album-a", trackIds: ["a-1", "a-2"] },
  { id: "album-b", trackIds: ["b-1", "b-2"] },
];

const pointerPosition = (overrides: Partial<SidebarDropPosition> = {}): SidebarDropPosition => ({
  deltaY: 0,
  overId: "track:target",
  overRect: { top: 100, height: 40 },
  ...overrides,
});

const resolve = (overrides: Partial<Parameters<typeof resolveSidebarDragCommand>[0]> = {}) =>
  resolveSidebarDragCommand({
    active: { type: "track", trackId: "a-1", container: "album", albumId: "album-a" },
    over: { type: "track", trackId: "b-1", container: "album", albumId: "album-b" },
    position: pointerPosition(),
    albums,
    looseTrackIds: ["loose-1", "loose-2"],
    dragStartY: 100,
    recentLooseTarget: null,
    now: 1_000,
    ...overrides,
  });

describe("sidebar drag controller", () => {
  it("keeps an empty loose drop target available at the first album without reserving space", () => {
    const looseContainer = {
      id: LOOSE_CONTAINER_ID,
      data: { current: { type: "container", container: "loose" } },
    };
    const firstAlbum = {
      id: "album:album-a",
      data: { current: { type: "album", albumId: "album-a" } },
    };

    const collisionArgs = (y: number) =>
      ({
        active: {
          data: {
            current: { type: "track", trackId: "a-1", container: "album", albumId: "album-a" },
          },
        },
        droppableContainers: [looseContainer, firstAlbum],
        droppableRects: new Map([
          [LOOSE_CONTAINER_ID, { top: 100 }],
          ["album:album-a", { top: 100 }],
        ]),
        pointerCoordinates: { x: 10, y },
      }) as never;

    expect(emptyLooseDropCollision(collisionArgs(112))).toEqual([{ id: LOOSE_CONTAINER_ID }]);
    expect(emptyLooseDropCollision(collisionArgs(125))).toBeNull();
  });

  it("reorders albums by the album containing the drop target", () => {
    expect(
      resolve({
        active: { type: "album", albumId: "album-a" },
        over: { type: "track", trackId: "b-1", container: "album", albumId: "album-b" },
      }),
    ).toEqual({ type: "reorder-album", albumId: "album-a", targetIndex: 1 });
  });

  it("places pointer-driven cross-album moves relative to the target midpoint", () => {
    expect(
      resolve({
        dragStartY: 90,
        position: pointerPosition({ deltaY: 35 }),
      }),
    ).toEqual({
      type: "move-track-to-album",
      trackId: "a-1",
      albumId: "album-b",
      placement: "after",
      referenceTrackId: "b-1",
    });
  });

  it("uses list order for keyboard reordering", () => {
    expect(
      resolve({
        active: { type: "track", trackId: "loose-2", container: "loose" },
        over: { type: "track", trackId: "loose-1", container: "loose" },
        dragStartY: null,
      }),
    ).toEqual({
      type: "move-track-to-loose",
      trackId: "loose-2",
      placement: "before",
      referenceTrackId: "loose-1",
    });
  });

  it("turns a centered loose-track drop into the create-album gesture", () => {
    expect(
      resolve({
        active: { type: "track", trackId: "loose-1", container: "loose" },
        over: { type: "track", trackId: "loose-2", container: "loose" },
        dragStartY: 100,
        position: pointerPosition({ overRect: { top: 50, height: 100 } }),
      }),
    ).toEqual({
      type: "create-album-from-loose-tracks",
      sourceTrackId: "loose-1",
      targetTrackId: "loose-2",
    });
  });

  it("preserves a recently crossed loose target when collision falls back to its container", () => {
    expect(
      resolve({
        active: { type: "track", trackId: "loose-1", container: "loose" },
        over: { type: "container", container: "loose" },
        position: pointerPosition({ overId: LOOSE_CONTAINER_ID }),
        recentLooseTarget: { trackId: "loose-2", expiresAt: 1_001 },
      }),
    ).toEqual({
      type: "create-album-from-loose-tracks",
      sourceTrackId: "loose-1",
      targetTrackId: "loose-2",
    });
  });

  it("expires the recent loose target and treats the append zone as an ordinary move", () => {
    expect(
      resolve({
        active: { type: "track", trackId: "loose-1", container: "loose" },
        over: { type: "container", container: "loose" },
        position: pointerPosition({ overId: LOOSE_APPEND_CONTAINER_ID }),
        recentLooseTarget: { trackId: "loose-2", expiresAt: 2_000 },
      }),
    ).toEqual({
      type: "move-track-to-loose",
      trackId: "loose-1",
      placement: "append",
    });

    expect(
      resolve({
        active: { type: "track", trackId: "loose-1", container: "loose" },
        over: { type: "container", container: "loose" },
        position: pointerPosition({ overId: LOOSE_CONTAINER_ID }),
        recentLooseTarget: { trackId: "loose-2", expiresAt: 1_000 },
      }),
    ).toEqual({
      type: "move-track-to-loose",
      trackId: "loose-1",
      placement: "append",
    });
  });

  it("appends tracks dropped on an album card or empty album container", () => {
    expect(resolve({ over: { type: "album", albumId: "album-b" } })).toEqual({
      type: "move-track-to-album",
      trackId: "a-1",
      albumId: "album-b",
      placement: "append",
    });

    expect(
      resolve({ over: { type: "container", container: "album", albumId: "album-b" } }),
    ).toEqual({
      type: "move-track-to-album",
      trackId: "a-1",
      albumId: "album-b",
      placement: "append",
    });
  });
});
