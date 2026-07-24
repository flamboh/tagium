"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import {
  AlertCircle,
  Ban,
  Check,
  Download,
  FileMusic,
  Link2,
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AlbumCoverThumb } from "@/features/library/AlbumCoverThumb";
import {
  albumItemId,
  trackItemId,
  type SidebarDragData,
  type SidebarDropData,
} from "@/features/library/sidebarDnd";
import type { AlbumGroup, TagiumFile } from "@/features/library/types";
import type { AlbumActionItem, AlbumActionItemId } from "@/features/library/albumActionItems";

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
  const previousStatusRef = useRef(track.status);
  const successTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [showSavedCheck, setShowSavedCheck] = useState(false);
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

  useEffect(() => {
    const transitionedToSaved = previousStatusRef.current !== "saved" && track.status === "saved";
    previousStatusRef.current = track.status;

    if (successTimerRef.current !== null) {
      globalThis.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }

    if (transitionedToSaved) {
      setShowSavedCheck(true);
      successTimerRef.current = globalThis.setTimeout(() => {
        setShowSavedCheck(false);
        successTimerRef.current = null;
      }, 3_000);
    } else if (track.status !== "saved") {
      setShowSavedCheck(false);
    }

    return () => {
      if (successTimerRef.current !== null) {
        globalThis.clearTimeout(successTimerRef.current);
        successTimerRef.current = null;
      }
    };
  }, [track.status]);

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
              <FileMusic className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <span className="min-w-3 text-[11px] text-muted-foreground">{index}</span>
            )}
            <span className="truncate text-sm flex-1">{track.filename}</span>
            {track.downloadStatus === "downloading" && (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
            )}
            {track.downloadStatus !== "downloading" && showSavedCheck && (
              <Check
                aria-hidden="true"
                className="h-3 w-3 shrink-0 animate-in fade-in text-green-500 motion-reduce:animate-none"
              />
            )}
            {(track.downloadStatus === "error" || track.status === "error") && (
              <AlertCircle
                aria-label="track has an error"
                className={cn(
                  "h-3 w-3 shrink-0 text-red-500",
                  retryable ? "group-hover:opacity-0" : "",
                )}
              />
            )}
            {track.downloadStatus === "canceled" && (
              <Ban className="h-3 w-3 text-muted-foreground flex-shrink-0 group-hover:opacity-0" />
            )}
          </div>
        </div>
      </Button>
      {showSavedCheck && (
        <span role="status" aria-live="polite" className="sr-only">
          track saved
        </span>
      )}
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
        aria-label="remove track"
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
  cleanupSuggestionCount: number;
  actions: AlbumActionItem[];
  children: ReactNode;
  onSelect: (event: ReactMouseEvent) => void;
  onDownload: () => void;
  onFileDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onFileDrop: (event: React.DragEvent<HTMLDivElement>) => void;
};

const albumActionIcon = (actionId: AlbumActionItemId, shareLabel: AlbumActionItem["label"]) => {
  if (actionId === "edit") return Pencil;
  if (actionId === "cleanup") return Sparkles;
  return shareLabel === "share album" ? Share2 : Link2;
};

export function SortableAlbumCard({
  album,
  selected,
  canDownload,
  cleanupSuggestionCount,
  actions,
  children,
  onSelect,
  onDownload,
  onFileDragOver,
  onFileDrop,
}: AlbumCardProps) {
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
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
                className="h-7 w-7 [@media(pointer:coarse)]:size-10"
                onClick={onDownload}
                disabled={!canDownload}
                aria-label={`download ${album.title}`}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {canDownload ? "download album" : "album tracks need files, metadata, and filenames"}
          </TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={menuTriggerRef}
              type="button"
              variant="ghost"
              size="icon"
              className="relative h-7 w-7 [@media(pointer:coarse)]:size-10"
              aria-label={`album actions for ${album.title}${
                cleanupSuggestionCount > 0 ? ", cleanup suggested" : ""
              }`}
            >
              <MoreVertical className="h-3.5 w-3.5" />
              {cleanupSuggestionCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary"
                />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {actions.map((action) => {
              const ActionIcon = albumActionIcon(action.id, action.label);
              return (
                <DropdownMenuItem
                  key={action.id}
                  disabled={action.disabled}
                  className="items-start py-2 [@media(pointer:coarse)]:min-h-10"
                  onSelect={() => action.onSelect({ returnFocusTarget: menuTriggerRef.current })}
                >
                  <ActionIcon className={cn("mt-0.5", action.id === "cleanup" && "text-primary")} />
                  <span className="min-w-0 flex-1">
                    <span className="block">{action.label}</span>
                    {action.secondaryText && (
                      <span className="block text-xs text-muted-foreground">
                        {action.secondaryText}
                      </span>
                    )}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
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
        "flex flex-col transition-shadow",
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
