"use client";

import type { DragEvent as ReactDragEvent } from "react";
import { useRef, useState } from "react";
import {
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  resolveSidebarDragCommand,
  type RecentLooseTarget,
  type SidebarDragCommand,
  type TrackPlacement,
} from "@/features/library/sidebarDragController";
import { sidebarCollisionDetection } from "@/features/library/sidebarDnd";
import type { SidebarDragData, SidebarDropData } from "@/features/library/sidebarDnd";
import type { AlbumGroup } from "@/features/library/types";

interface AlbumSidebarDragActions {
  onMoveTrackToAlbum: (
    trackId: string,
    targetAlbumId: string,
    placement: TrackPlacement,
    referenceTrackId?: string,
  ) => void;
  onMoveTrackToLoose: (
    trackId: string,
    placement: TrackPlacement,
    referenceTrackId?: string,
  ) => void;
  onPromptCreateAlbumFromLooseTracks: (sourceTrackId: string, targetTrackId: string) => void;
  onReorderAlbums: (albumId: string, targetIndex: number) => void;
  onAudioUpload: (files: File[]) => void;
  onUploadToAlbum: (albumId: string, files: File[]) => void;
}

interface UseAlbumSidebarDragControllerOptions extends AlbumSidebarDragActions {
  albums: AlbumGroup[];
  looseTrackIds: string[];
}

const dragStartY = (event: Event) => {
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

const isFileDrag = (event: ReactDragEvent) => event.dataTransfer.types.includes("Files");

const acceptFileDrag = (event: ReactDragEvent, nested: boolean) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  if (nested) event.stopPropagation();
  event.dataTransfer.dropEffect = "copy";
};

const acceptFileDrop = (event: ReactDragEvent, onUpload: (files: File[]) => void) => {
  const files = Array.from(event.dataTransfer.files);
  if (files.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  onUpload(files);
};

const runCommand = (command: SidebarDragCommand | null, actions: AlbumSidebarDragActions) => {
  if (!command) return;
  switch (command.type) {
    case "reorder-album":
      actions.onReorderAlbums(command.albumId, command.targetIndex);
      break;
    case "move-track-to-album":
      actions.onMoveTrackToAlbum(
        command.trackId,
        command.albumId,
        command.placement,
        command.referenceTrackId,
      );
      break;
    case "move-track-to-loose":
      actions.onMoveTrackToLoose(command.trackId, command.placement, command.referenceTrackId);
      break;
    case "create-album-from-loose-tracks":
      actions.onPromptCreateAlbumFromLooseTracks(command.sourceTrackId, command.targetTrackId);
      break;
  }
};

export function useAlbumSidebarDragController(options: UseAlbumSidebarDragControllerOptions) {
  const [activeDrag, setActiveDrag] = useState<SidebarDragData | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const recentLooseTargetRef = useRef<RecentLooseTarget | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const resetDrag = () => {
    dragStartYRef.current = null;
    recentLooseTargetRef.current = null;
    setActiveDrag(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDrag((event.active.data.current as SidebarDragData | undefined) ?? null);
    recentLooseTargetRef.current = null;
    dragStartYRef.current = dragStartY(event.activatorEvent);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const active = event.active.data.current as SidebarDragData | undefined;
    const over = event.over?.data.current as SidebarDropData | undefined;
    if (active?.type !== "track" || active.container !== "loose") return;
    if (over?.type !== "track" || over.container !== "loose") return;
    if (over.trackId === active.trackId) return;
    recentLooseTargetRef.current = { trackId: over.trackId, expiresAt: Date.now() + 700 };
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const active = event.active.data.current as SidebarDragData | undefined;
    const over = event.over?.data.current as SidebarDropData | undefined;
    if (active && over && event.over) {
      runCommand(
        resolveSidebarDragCommand({
          active,
          over,
          albums: options.albums,
          looseTrackIds: options.looseTrackIds,
          dragStartY: dragStartYRef.current,
          recentLooseTarget: recentLooseTargetRef.current,
          now: Date.now(),
          position: {
            deltaY: event.delta.y,
            overId: event.over.id,
            overRect: event.over.rect,
          },
        }),
        options,
      );
    }
    resetDrag();
  };

  return {
    activeDrag,
    dndContextProps: {
      sensors,
      collisionDetection: sidebarCollisionDetection,
      onDragStart: handleDragStart,
      onDragOver: handleDragOver,
      onDragCancel: resetDrag,
      onDragEnd: handleDragEnd,
    },
    libraryFileDropProps: {
      onDragOver: (event: ReactDragEvent<HTMLDivElement>) => acceptFileDrag(event, false),
      onDrop: (event: ReactDragEvent<HTMLDivElement>) =>
        acceptFileDrop(event, options.onAudioUpload),
    },
    albumFileDropProps: (albumId: string) => ({
      onFileDragOver: (event: ReactDragEvent<HTMLDivElement>) => acceptFileDrag(event, true),
      onFileDrop: (event: ReactDragEvent<HTMLDivElement>) =>
        acceptFileDrop(event, (files) => options.onUploadToAlbum(albumId, files)),
    }),
  };
}
