"use client";

import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { useRef, useState } from "react";
import { Moon, Settings, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import AlbumSidebar from "@/features/library/AlbumSidebar";
import PlaylistDownloadQueuePanel, {
  type PlaylistDownloadQueuePanelState,
} from "@/features/import/PlaylistDownloadQueuePanel";
import { AlbumGroup, TagiumFile } from "@/features/library/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { allTracksReadyForDownload } from "@/features/export/downloadLibrary";
import { isValidFilenameBase } from "@/features/library/filename";
import type { ShareAlbumActionState } from "@/features/share/sharePublication";
import { useTheme } from "@/features/theme/useTheme";

export interface TagSidebarPanelProps {
  mobileOpen?: boolean;
  mobileDrawerRef?: RefObject<HTMLDivElement | null>;
  onMobileClose?: () => void;
  loading: boolean;
  files: TagiumFile[];
  albums: AlbumGroup[];
  looseTrackIds: string[];
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
  cleanupSuggestionCountByAlbumId: ReadonlyMap<string, number>;
  settingsOpen: boolean;
  onAudioUpload: (files: File[]) => void;
  onSelectAlbum: (albumId: string, event?: ReactMouseEvent) => void;
  onSelectFile: (albumId: string, fileId: string, event?: ReactMouseEvent) => void;
  onSelectLooseTrack: (fileId: string, event?: ReactMouseEvent) => void;
  onClearSelection: () => void;
  onRemoveFile: (fileId: string) => void;
  onRetryDownload: (fileId: string) => void;
  onAddAlbum: () => void;
  onEditAlbum: (albumId: string) => void;
  onReviewAlbumCleanup: (albumId: string, returnFocusTarget: HTMLButtonElement | null) => void;
  onDownloadAlbum: (albumId: string) => void;
  onShareAlbum?: (albumId: string) => void;
  shareAlbumActions?: Readonly<Record<string, ShareAlbumActionState>>;
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
  playlistDownloadQueue?: PlaylistDownloadQueuePanelState | null;
  onDownloadAll: () => void;
  onOpenSettings: () => void;
  onCancelPlaylistDownloadQueue?: () => void;
  onRetryPlaylistDownloadQueue?: () => void;
}

export const MOBILE_DRAWER_TRANSITION_CLASSES =
  "transition-[translate,visibility,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]";

const isFileDrag = (event: React.DragEvent<HTMLDivElement>) =>
  event.dataTransfer.types.includes("Files");

export default function TagSidebarPanel({
  mobileOpen = false,
  mobileDrawerRef,
  onMobileClose,
  loading,
  files,
  albums,
  looseTrackIds,
  selectedAlbumId,
  selectedFileId,
  selectedFileIds,
  cleanupSuggestionCountByAlbumId,
  settingsOpen,
  onAudioUpload,
  onSelectAlbum,
  onSelectFile,
  onSelectLooseTrack,
  onClearSelection,
  onRemoveFile,
  onRetryDownload,
  onAddAlbum,
  onEditAlbum,
  onReviewAlbumCleanup,
  onDownloadAlbum,
  onShareAlbum,
  shareAlbumActions,
  onUploadToAlbum,
  onMoveTrackToAlbum,
  onMoveTrackToLoose,
  onPromptCreateAlbumFromLooseTracks,
  onReorderAlbums,
  playlistDownloadQueue = null,
  onDownloadAll,
  onOpenSettings,
  onCancelPlaylistDownloadQueue,
  onRetryPlaylistDownloadQueue,
}: TagSidebarPanelProps) {
  const dragCounterRef = useRef(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const canDownloadAll = files.length > 0 && allTracksReadyForDownload(files);
  const hasInvalidFilename = files.some(
    (file) => file.metadata && !isValidFilenameBase(file.metadata.filename),
  );
  const downloadAllReason = loading
    ? "download in progress"
    : files.length === 0
      ? "add tracks first"
      : hasInvalidFilename
        ? "every track needs a filename"
        : "tracks need files and metadata";

  const handleSidebarDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;

    event.preventDefault();
    dragCounterRef.current++;
    setIsDraggingFile(true);
  };

  const handleSidebarDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;

    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingFile(false);
    }
  };

  const handleSidebarFileDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingFile(false);
    onAudioUpload(files);
  };

  return (
    <div
      data-slot="sidebar-panel"
      ref={mobileDrawerRef}
      tabIndex={mobileOpen ? -1 : undefined}
      role={mobileOpen ? "dialog" : undefined}
      aria-modal={mobileOpen ? "true" : undefined}
      aria-label={mobileOpen ? "library" : undefined}
      className={cn(
        `order-2 h-svh w-full flex-shrink-0 flex flex-col border-t bg-background text-foreground overflow-hidden ${MOBILE_DRAWER_TRANSITION_CLASSES} md:order-none md:h-auto md:min-h-0 md:w-72 md:translate-x-0 md:border-t-0 md:border-r`,
        "fixed inset-y-0 left-0 z-50 w-[min(88vw,22rem)] border-r shadow-xl md:static md:visible md:opacity-100 md:shadow-none",
        mobileOpen ? "translate-x-0 visible opacity-100" : "-translate-x-full invisible opacity-0",
        "motion-reduce:duration-100 motion-reduce:transition-opacity motion-reduce:translate-x-0",
        isDraggingFile && "bg-brand/5 shadow-[inset_0_0_0_2px_var(--brand)]",
      )}
      onDragEnter={handleSidebarDragEnter}
      onDragLeave={handleSidebarDragLeave}
      onDropCapture={(event) => {
        if (!isFileDrag(event)) return;

        dragCounterRef.current = 0;
        setIsDraggingFile(false);
      }}
      onDragOver={(event) => {
        if (isFileDrag(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={handleSidebarFileDrop}
    >
      <div className="h-14 flex items-center px-5 border-b flex-shrink-0">
        <span className="font-bold text-xl tracking-tight select-none">tagium</span>
        <button
          type="button"
          className={cn(
            "group ml-auto inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            !(mobileOpen && onMobileClose) && "-mr-3",
          )}
          aria-label={`switch to ${theme === "light" ? "dark" : "light"} mode`}
          onClick={toggleTheme}
        >
          {theme === "light" ? (
            <Moon className="size-4 origin-center transition-transform duration-150 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
          ) : (
            <Sun className="size-4 origin-center transition-transform duration-150 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
          )}
        </button>
        {mobileOpen && onMobileClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 md:hidden"
            aria-label="close library"
            onClick={onMobileClose}
          >
            <X />
          </Button>
        ) : null}
      </div>

      <AlbumSidebar
        albums={albums}
        looseTrackIds={looseTrackIds}
        files={files}
        selectedAlbumId={selectedAlbumId}
        selectedFileId={selectedFileId}
        selectedFileIds={selectedFileIds}
        cleanupSuggestionCountByAlbumId={cleanupSuggestionCountByAlbumId}
        onSelectAlbum={onSelectAlbum}
        onSelectFile={onSelectFile}
        onSelectLooseTrack={onSelectLooseTrack}
        onClearSelection={onClearSelection}
        onRemoveFile={onRemoveFile}
        onRetryDownload={onRetryDownload}
        onAddAlbum={onAddAlbum}
        onEditAlbum={onEditAlbum}
        onReviewAlbumCleanup={onReviewAlbumCleanup}
        onDownloadAlbum={onDownloadAlbum}
        onShareAlbum={onShareAlbum}
        shareAlbumActions={shareAlbumActions}
        onUploadToAlbum={onUploadToAlbum}
        onMoveTrackToAlbum={onMoveTrackToAlbum}
        onMoveTrackToLoose={onMoveTrackToLoose}
        onPromptCreateAlbumFromLooseTracks={onPromptCreateAlbumFromLooseTracks}
        onReorderAlbums={onReorderAlbums}
        onAudioUpload={onAudioUpload}
      />

      <PlaylistDownloadQueuePanel
        queue={playlistDownloadQueue}
        onCancel={onCancelPlaylistDownloadQueue}
        onRetry={onRetryPlaylistDownloadQueue}
      />

      <div className="px-3 py-3 border-t flex-shrink-0 flex flex-col gap-2">
        {canDownloadAll && !loading ? (
          <Button className="w-full [@media(pointer:coarse)]:min-h-11" onClick={onDownloadAll}>
            download all
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block">
                <Button
                  className="w-full [@media(pointer:coarse)]:min-h-11"
                  onClick={onDownloadAll}
                  disabled
                >
                  {loading ? "downloading..." : "download all"}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{downloadAllReason}</TooltipContent>
          </Tooltip>
        )}
        <Button
          variant="outline"
          data-export-focus-fallback
          className={cn(
            "h-auto w-full flex-col justify-center gap-1 py-3 text-center",
            settingsOpen &&
              "border-transparent bg-accent text-accent-foreground shadow-none hover:bg-accent",
          )}
          onClick={onOpenSettings}
        >
          <Settings />
          settings
        </Button>
      </div>
    </div>
  );
}
