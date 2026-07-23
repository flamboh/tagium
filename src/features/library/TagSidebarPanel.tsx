"use client";

import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Settings, X } from "lucide-react";
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

export interface TagSidebarPanelProps {
  loading: boolean;
  files: TagiumFile[];
  albums: AlbumGroup[];
  looseTrackIds: string[];
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
  albumIdsWithCleanupSuggestions: ReadonlySet<string>;
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
  onReviewAlbumCleanup: (albumId: string) => void;
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
  playlistDownloadQueue?: PlaylistDownloadQueuePanelState | null;
  onDownloadAll: () => void;
  onOpenSettings: () => void;
  onCancelPlaylistDownloadQueue?: () => void;
  onRetryPlaylistDownloadQueue?: () => void;
  mobilePresentation?: "library" | "hidden" | "drawer";
  onCloseMobileDrawer?: () => void;
}

const isFileDrag = (event: React.DragEvent<HTMLDivElement>) =>
  event.dataTransfer.types.includes("Files");

export default function TagSidebarPanel({
  loading,
  files,
  albums,
  looseTrackIds,
  selectedAlbumId,
  selectedFileId,
  selectedFileIds,
  albumIdsWithCleanupSuggestions,
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
  mobilePresentation = "library",
  onCloseMobileDrawer,
}: TagSidebarPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeSheetButtonRef = useRef<HTMLButtonElement>(null);
  const dragCounterRef = useRef(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
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

  useEffect(() => {
    if (mobilePresentation === "drawer") closeSheetButtonRef.current?.focus();
  }, [mobilePresentation]);

  const trapDrawerFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (mobilePresentation !== "drawer") return;
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseMobileDrawer?.();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => !element.hasAttribute("inert"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

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
      ref={panelRef}
      id="tagium-library"
      data-mobile-library={mobilePresentation}
      role={mobilePresentation === "drawer" ? "dialog" : undefined}
      aria-modal={mobilePresentation === "drawer" ? true : undefined}
      aria-label={mobilePresentation === "drawer" ? "library" : undefined}
      aria-hidden={mobilePresentation === "hidden" ? true : undefined}
      inert={mobilePresentation === "hidden" ? true : undefined}
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-svh w-(--mobile-drawer-width) shrink-0 flex-col overflow-hidden border-r bg-card transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none md:static md:z-auto md:order-none md:h-auto md:min-h-0 md:w-72 md:translate-x-0 md:border-t-0 md:border-r md:transition-none",
        mobilePresentation === "hidden" && "-translate-x-full",
        mobilePresentation === "drawer" && "translate-x-0",
        isDraggingFile && "bg-primary/5 shadow-[inset_0_0_0_2px_var(--primary)]",
      )}
      onKeyDown={trapDrawerFocus}
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
      <div className="h-14 flex shrink-0 items-center justify-between border-b px-5">
        <span className="font-bold text-xl tracking-tight select-none">tagium</span>
        {mobilePresentation === "drawer" && (
          <Button
            ref={closeSheetButtonRef}
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 md:hidden"
            onClick={onCloseMobileDrawer}
            aria-label="close library"
          >
            <X className="size-5" />
          </Button>
        )}
      </div>

      <AlbumSidebar
        albums={albums}
        looseTrackIds={looseTrackIds}
        files={files}
        selectedAlbumId={selectedAlbumId}
        selectedFileId={selectedFileId}
        selectedFileIds={selectedFileIds}
        albumIdsWithCleanupSuggestions={albumIdsWithCleanupSuggestions}
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

      <div className="flex shrink-0 flex-col gap-2 border-t px-3 py-3">
        {canDownloadAll && !loading ? (
          <Button className="w-full" onClick={onDownloadAll}>
            download all
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block">
                <Button className="w-full" onClick={onDownloadAll} disabled>
                  {loading ? "downloading..." : "download all"}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{downloadAllReason}</TooltipContent>
          </Tooltip>
        )}
        <Button
          variant="outline"
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
