"use client";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import {
  closestCorners,
  type CollisionDetection,
  type DragEndEvent,
  pointerWithin,
  rectIntersection,
  useDroppable,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import {
  AlertCircle,
  Ban,
  Check,
  Download,
  FileMusic,
  Loader2,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AlbumCoverThumb } from "./AlbumCoverThumb";
import type { AlbumGroup, TagiumFile } from "./types";

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

const artistLabel = (artist: string) => (artist ? artist : "unknown");

type TrackRowBaseProps = {
  track: TagiumFile;
  selectedTone: "primary" | "secondary" | null;
  muted: boolean;
  retryable: boolean;
  onSelect: (event: ReactMouseEvent) => void;
  onRemove: () => void;
  onRetry: () => void;
};

type TrackRowProps =
  | (TrackRowBaseProps & { container: "album"; albumId: string; index: number })
  | (TrackRowBaseProps & { container: "loose"; albumId?: never; index?: never });

const sortableStyle = (
  transform: { x: number; y: number; scaleX: number; scaleY: number } | null,
  transition: string | undefined,
) => ({
  transform: transform
    ? `translate3d(0, ${Math.round(transform.y)}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
    : undefined,
  transition,
});

export function SortableTrackRow({
  track,
  index,
  container,
  albumId,
  selectedTone,
  muted,
  retryable,
  onSelect,
  onRemove,
  onRetry,
}: TrackRowProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: trackItemId(track.id),
    data:
      container === "album"
        ? ({ type: "track", trackId: track.id, container, albumId } satisfies SidebarDragData)
        : ({ type: "track", trackId: track.id, container } satisfies SidebarDragData),
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative group border-t first:border-t-0",
        container === "loose" ? "border-b border-t-0 first:border-t-0" : "",
        isDragging ? "z-10 opacity-60" : "",
      )}
      style={sortableStyle(transform, transition)}
    >
      <Button
        type="button"
        ref={setActivatorNodeRef}
        variant="ghost"
        className={cn(
          "justify-start h-auto py-2.5 px-4 pr-8 w-full text-left font-normal rounded-none hover:bg-accent/30",
          container === "loose" ? "py-3" : "",
          muted ? "opacity-65" : "",
          selectedTone === "primary" ? "bg-accent text-accent-foreground" : "",
          selectedTone === "secondary" ? "bg-accent/50 text-accent-foreground" : "",
        )}
        onClick={onSelect}
        {...attributes}
        {...listeners}
      >
        <div className="flex flex-col gap-1 w-full min-w-0">
          <div className="flex items-center gap-1.5 w-full overflow-hidden">
            {container === "loose" ? (
              <FileMusic className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            ) : (
              <span className="min-w-3 text-[11px] text-muted-foreground">{index}</span>
            )}
            <span className="truncate text-sm flex-1">{track.filename}</span>
            {track.downloadStatus === "downloading" && (
              <Loader2 className="h-3 w-3 text-muted-foreground flex-shrink-0 animate-spin" />
            )}
            {track.downloadStatus !== "downloading" && track.status === "saved" && (
              <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
            )}
            {(track.downloadStatus === "error" || track.status === "error") && (
              <AlertCircle
                aria-label="track has an error"
                className={cn(
                  "h-3 w-3 text-red-500 flex-shrink-0",
                  retryable ? "group-hover:opacity-0" : "",
                )}
              />
            )}
            {track.downloadStatus === "canceled" && (
              <Ban className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            )}
          </div>
          {track.downloadStatus === "canceled" && (
            <span className="pl-7 text-xs text-muted-foreground truncate" aria-live="polite">
              canceled
            </span>
          )}
        </div>
      </Button>
      {retryable && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRetry();
          }}
          className="absolute right-7 top-2.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-accent rounded-full cursor-pointer"
          title="retry download"
          aria-label={`retry download for ${track.filename}`}
        >
          <RefreshCw className="h-3 w-3 text-muted-foreground hover:text-primary" />
        </button>
      )}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/10 rounded-full cursor-pointer"
        title="remove track"
      >
        <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
      </button>
    </div>
  );
}

type AlbumCardProps = {
  album: AlbumGroup;
  selected: boolean;
  canDownload: boolean;
  children: ReactNode;
  onSelect: (event: ReactMouseEvent) => void;
  onEdit: () => void;
  onDownload: () => void;
  onFileDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onFileDrop: (event: React.DragEvent<HTMLDivElement>) => void;
};

export function SortableAlbumCard({
  album,
  selected,
  canDownload,
  children,
  onSelect,
  onEdit,
  onDownload,
  onFileDragOver,
  onFileDrop,
}: AlbumCardProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: albumItemId(album.id),
    data: { type: "album", albumId: album.id } satisfies SidebarDragData,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "border-b transition-all shrink-0",
        selected ? "bg-primary/5" : "",
        isDragging ? "z-10 opacity-60" : "",
      )}
      style={sortableStyle(transform, transition)}
      onDragOver={onFileDragOver}
      onDrop={onFileDrop}
    >
      <div className="w-full flex items-center justify-between gap-1 px-3 py-3 border-b">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="min-w-0 flex-1 flex items-center gap-2 text-left cursor-pointer"
          onClick={onSelect}
          {...attributes}
          {...listeners}
        >
          <AlbumCoverThumb picture={album.cover} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate leading-tight">{album.title}</div>
            <div className="text-xs text-muted-foreground truncate leading-tight">
              {artistLabel(album.artist)} &middot; {album.trackIds.length} track
              {album.trackIds.length !== 1 ? "s" : ""}
            </div>
          </div>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onDownload}
                disabled={!canDownload}
                aria-label={`download ${album.title}`}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {canDownload ? "download album" : "album needs ready tracks"}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onEdit}
              aria-label={`edit ${album.title}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>edit album</TooltipContent>
        </Tooltip>
      </div>
      {children}
    </div>
  );
}

export function DroppableTrackContainer({
  id,
  data,
  children,
  className,
}: {
  id: string;
  data: SidebarDropData;
  children?: ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col min-h-8 transition-shadow",
        isOver ? "shadow-[inset_0_0_0_2px_var(--primary)]" : "",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SidebarDragPreview({
  active,
  album,
  track,
}: {
  active: SidebarDragData;
  album?: AlbumGroup;
  track?: TagiumFile;
}) {
  if (active.type === "album" && album) {
    return (
      <div className="flex w-64 max-w-[calc(100vw-2rem)] items-center gap-2 rounded-md border bg-card px-3 py-3 text-left shadow-lg">
        <AlbumCoverThumb picture={album.cover} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight">{album.title}</div>
          <div className="truncate text-xs text-muted-foreground leading-tight">
            {artistLabel(album.artist)} &middot; {album.trackIds.length} track
            {album.trackIds.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>
    );
  }

  if (active.type === "track" && track) {
    return (
      <div className="flex w-64 max-w-[calc(100vw-2rem)] items-center gap-2 rounded-md border bg-card px-4 py-3 text-left shadow-lg">
        <FileMusic className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm">{track.filename}</span>
      </div>
    );
  }

  return null;
}
