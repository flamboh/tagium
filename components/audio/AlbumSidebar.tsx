"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  useSensor,
  useSensors,
  TouchSensor,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlbumSidebarEmptyState } from "./AlbumSidebarEmptyState";
import {
  DroppableTrackContainer,
  SidebarDragPreview,
  SortableAlbumCard,
  SortableTrackRow,
} from "./AlbumSidebarDnd";
import {
  albumIdFromDrop,
  albumContainerId,
  albumItemId,
  dragStartY,
  isCenteredLooseDrop,
  LOOSE_APPEND_CONTAINER_ID,
  LOOSE_CONTAINER_ID,
  rowPlacement,
  sidebarCollisionDetection,
  trackItemId,
  type SidebarDragData,
  type SidebarDropData,
} from "./sidebarDnd";
import type { AlbumGroup, TagiumFile } from "./types";
import { isTrackReadyForDownload } from "./downloadLibrary";

interface AlbumSidebarProps {
  albums: AlbumGroup[];
  looseTrackIds: string[];
  files: TagiumFile[];
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
  onSelectAlbum: (albumId: string, event?: ReactMouseEvent) => void;
  onSelectFile: (albumId: string, fileId: string, event?: ReactMouseEvent) => void;
  onSelectLooseTrack: (fileId: string, event?: ReactMouseEvent) => void;
  onRemoveFile: (fileId: string) => void;
  onRetryDownload: (fileId: string) => void;
  onAddAlbum: () => void;
  onEditAlbum: (albumId: string) => void;
  onDownloadAlbum: (albumId: string) => void;
  onUploadToAlbum: (albumId: string, files: File[]) => void;
  onMoveTrackToAlbum: (
    trackId: string,
    targetAlbumId: string,
    placement: "before" | "after" | "append",
    referenceTrackId?: string,
  ) => void;
  onMoveTrackToLoose: (
    trackId: string,
    placement: "before" | "after" | "append",
    referenceTrackId?: string,
  ) => void;
  onPromptCreateAlbumFromLooseTracks: (sourceTrackId: string, targetTrackId: string) => void;
  onReorderAlbums: (albumId: string, targetIndex: number) => void;
  onAudioUpload: (files: File[]) => void;
}

const isFileDrag = (event: React.DragEvent) => event.dataTransfer.types.includes("Files");

const isRetryableError = (track: TagiumFile) =>
  Boolean(track.downloadRequest) &&
  (track.downloadStatus === "error" ||
    track.downloadStatus === "canceled" ||
    track.status === "error");

const handleFileDrop = (event: React.DragEvent, onUpload: (files: File[]) => void) => {
  const droppedFiles = Array.from(event.dataTransfer.files);
  if (droppedFiles.length === 0) return;

  event.preventDefault();
  event.stopPropagation();
  onUpload(droppedFiles);
};

export default function AlbumSidebar({
  albums,
  looseTrackIds,
  files,
  selectedAlbumId,
  selectedFileId,
  selectedFileIds,
  onSelectAlbum,
  onSelectFile,
  onSelectLooseTrack,
  onRemoveFile,
  onRetryDownload,
  onAddAlbum,
  onEditAlbum,
  onDownloadAlbum,
  onUploadToAlbum,
  onMoveTrackToAlbum,
  onMoveTrackToLoose,
  onPromptCreateAlbumFromLooseTracks,
  onReorderAlbums,
  onAudioUpload,
}: AlbumSidebarProps) {
  const [activeDrag, setActiveDrag] = useState<SidebarDragData | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const recentLooseTargetRef = useRef<{ trackId: string; expiresAt: number } | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const filesById = new Map(files.map((file) => [file.id, file]));
  const activeTrack = activeDrag?.type === "track" ? filesById.get(activeDrag.trackId) : undefined;
  const activeAlbum =
    activeDrag?.type === "album"
      ? albums.find((album) => album.id === activeDrag.albumId)
      : undefined;
  const looseTracks = looseTrackIds
    .map((trackId) => filesById.get(trackId))
    .filter((track): track is TagiumFile => Boolean(track));

  const selectedTone = (trackId: string) => {
    if (selectedFileIds.has(trackId)) return "primary";
    if (selectedFileId === trackId) return "secondary";
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDrag((event.active.data.current as SidebarDragData | undefined) ?? null);
    recentLooseTargetRef.current = null;
    dragStartYRef.current = dragStartY(event.activatorEvent);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const active = event.active.data.current as SidebarDragData | undefined;
    const over = event.over?.data.current as SidebarDropData | undefined;
    if (active?.type !== "track") return;
    if (active.container !== "loose") return;
    if (over?.type !== "track") return;
    if (over.container !== "loose") return;
    if (over.trackId === active.trackId) return;
    recentLooseTargetRef.current = { trackId: over.trackId, expiresAt: Date.now() + 700 };
  };

  const trackIdsForDrop = (drop: Extract<SidebarDropData, { type: "track" }>) => {
    if (drop.container === "loose") return looseTrackIds;

    const album = albums.find((entry) => entry.id === drop.albumId);
    if (album) return album.trackIds;
    return [];
  };

  const handleAlbumDragEnd = (active: SidebarDragData, over: SidebarDropData) => {
    if (active.type !== "album") return;

    const targetAlbumId = albumIdFromDrop(over);

    if (targetAlbumId && targetAlbumId !== active.albumId) {
      const sourceIndex = albums.findIndex((album) => album.id === active.albumId);
      const targetIndex = albums.findIndex((album) => album.id === targetAlbumId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      onReorderAlbums(active.albumId, targetIndex);
    }
  };

  const handleTrackDragEnd = (
    event: DragEndEvent,
    active: SidebarDragData,
    over: SidebarDropData,
  ) => {
    if (active.type !== "track") return;

    if (over.type === "track") {
      if (over.trackId === active.trackId) return;

      const placement = rowPlacement(
        event,
        active.trackId,
        over.trackId,
        trackIdsForDrop(over),
        dragStartYRef.current,
      );
      if (over.container === "loose") {
        if (active.container === "loose" && isCenteredLooseDrop(event, dragStartYRef.current)) {
          onPromptCreateAlbumFromLooseTracks(active.trackId, over.trackId);
          return;
        }
        onMoveTrackToLoose(active.trackId, placement, over.trackId);
        return;
      }

      onMoveTrackToAlbum(active.trackId, over.albumId, placement, over.trackId);
      return;
    }

    if (over.type === "album") {
      onMoveTrackToAlbum(active.trackId, over.albumId, "append");
      return;
    }

    if (over.type === "container" && over.container === "album") {
      onMoveTrackToAlbum(active.trackId, over.albumId, "append");
      return;
    }

    if (over.type === "container" && over.container === "loose") {
      const recentLooseTarget = recentLooseTargetRef.current;
      if (
        active.container === "loose" &&
        event.over?.id !== LOOSE_APPEND_CONTAINER_ID &&
        recentLooseTarget &&
        recentLooseTarget.expiresAt > Date.now()
      ) {
        onPromptCreateAlbumFromLooseTracks(active.trackId, recentLooseTarget.trackId);
        return;
      }
      onMoveTrackToLoose(active.trackId, "append");
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const active = event.active.data.current as SidebarDragData | undefined;
    const over = event.over?.data.current as SidebarDropData | undefined;

    if (active && over) {
      handleAlbumDragEnd(active, over);
      handleTrackDragEnd(event, active, over);
    }
    dragStartYRef.current = null;
    recentLooseTargetRef.current = null;
    setActiveDrag(null);
  };

  if (albums.length === 0 && looseTracks.length === 0) {
    return <AlbumSidebarEmptyState onAddAlbum={onAddAlbum} />;
  }

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col">
      <div className="h-12 px-4 border-b flex items-center justify-between flex-shrink-0">
        <span className="font-semibold text-sm leading-none text-muted-foreground">
          library ({files.length})
        </span>
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onAddAlbum}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={sidebarCollisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragCancel={() => {
          dragStartYRef.current = null;
          recentLooseTargetRef.current = null;
          setActiveDrag(null);
        }}
        onDragEnd={handleDragEnd}
      >
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col"
          onDragOver={(event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => handleFileDrop(event, onAudioUpload)}
        >
          <SortableContext
            items={looseTracks.map((track) => trackItemId(track.id))}
            strategy={verticalListSortingStrategy}
          >
            <DroppableTrackContainer
              id={LOOSE_CONTAINER_ID}
              data={{ type: "container", container: "loose" }}
              className={
                looseTracks.length === 0 && activeDrag?.type === "track"
                  ? "min-h-12 shrink-0"
                  : "shrink-0"
              }
            >
              {looseTracks.map((track) => (
                <SortableTrackRow
                  key={track.id}
                  track={track}
                  container="loose"
                  selectedTone={selectedTone(track.id)}
                  muted={track.downloadStatus === "downloading"}
                  retryable={isRetryableError(track)}
                  onSelect={(event) => onSelectLooseTrack(track.id, event)}
                  onRetry={() => onRetryDownload(track.id)}
                  onRemove={() => onRemoveFile(track.id)}
                />
              ))}
            </DroppableTrackContainer>
          </SortableContext>

          <SortableContext
            items={albums.map((album) => albumItemId(album.id))}
            strategy={verticalListSortingStrategy}
          >
            {albums.map((album) => {
              const canDownloadAlbum =
                album.trackIds.length > 0 &&
                album.trackIds.every((trackId) => {
                  const file = filesById.get(trackId);
                  return file ? isTrackReadyForDownload(file) : false;
                });
              return (
                <SortableAlbumCard
                  key={album.id}
                  album={album}
                  selected={selectedAlbumId === album.id}
                  canDownload={canDownloadAlbum}
                  onSelect={(event) => onSelectAlbum(album.id, event)}
                  onEdit={() => onEditAlbum(album.id)}
                  onDownload={() => onDownloadAlbum(album.id)}
                  onFileDragOver={(event) => {
                    if (!isFileDrag(event)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = "copy";
                  }}
                  onFileDrop={(event) =>
                    handleFileDrop(event, (audioFiles) => onUploadToAlbum(album.id, audioFiles))
                  }
                >
                  <SortableContext
                    items={album.trackIds.map((trackId) => trackItemId(trackId))}
                    strategy={verticalListSortingStrategy}
                  >
                    <DroppableTrackContainer
                      id={albumContainerId(album.id)}
                      data={{ type: "container", container: "album", albumId: album.id }}
                    >
                      {album.trackIds.length === 0 ? (
                        <div className="text-xs text-muted-foreground px-4 py-3 text-center">
                          drag tracks here
                        </div>
                      ) : (
                        album.trackIds.map((trackId, index) => {
                          const track = filesById.get(trackId);
                          if (!track) return null;

                          return (
                            <SortableTrackRow
                              key={track.id}
                              track={track}
                              index={index + 1}
                              container="album"
                              albumId={album.id}
                              selectedTone={selectedTone(track.id)}
                              muted={track.downloadStatus === "downloading"}
                              retryable={isRetryableError(track)}
                              onSelect={(event) => onSelectFile(album.id, track.id, event)}
                              onRetry={() => onRetryDownload(track.id)}
                              onRemove={() => onRemoveFile(track.id)}
                            />
                          );
                        })
                      )}
                    </DroppableTrackContainer>
                  </SortableContext>
                </SortableAlbumCard>
              );
            })}
          </SortableContext>
          <DroppableTrackContainer
            id={LOOSE_APPEND_CONTAINER_ID}
            data={{ type: "container", container: "loose" }}
            className="flex-1 min-h-16"
          />
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDrag ? (
            <SidebarDragPreview active={activeDrag} album={activeAlbum} track={activeTrack} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
