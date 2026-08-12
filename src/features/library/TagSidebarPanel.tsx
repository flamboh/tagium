"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Download, Settings } from "lucide-react";
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

export interface TagSidebarPanelProps {
  loading: boolean;
  files: TagiumFile[];
  albums: AlbumGroup[];
  looseTrackIds: string[];
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
  cleanupSuggestionCountByAlbumId: ReadonlyMap<string, number>;
  settingsOpen: boolean;
  listeningGuideOpen: boolean;
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
  onOpenListeningGuide: () => void;
  onCancelPlaylistDownloadQueue?: () => void;
  onRetryPlaylistDownloadQueue?: () => void;
}

const isFileDrag = (event: React.DragEvent<HTMLDivElement>) =>
  event.dataTransfer.types.includes("Files");

const listeningGuideServices = ["spotify?", "apple music?", "spotify?"];
const sidebarEntryButtonClassName =
  "h-16 w-full flex-col gap-0 bg-transparent py-3 text-center shadow-none hover:bg-muted/30 dark:hover:bg-muted/30";
const sidebarIconButtonClassName =
  "h-10 w-full bg-transparent shadow-none hover:bg-muted/30 dark:hover:bg-muted/30";

function ListeningGuideEntryButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  const [serviceIndex, setServiceIndex] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => {
      setPrefersReducedMotion(mediaQuery.matches);
      setTransitionEnabled(!mediaQuery.matches);
      if (mediaQuery.matches) {
        setServiceIndex(0);
      }
    };

    updateMotionPreference();
    mediaQuery.addEventListener("change", updateMotionPreference);

    return () => mediaQuery.removeEventListener("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) return;

    const interval = setInterval(() => {
      setServiceIndex((current) =>
        current >= listeningGuideServices.length - 1 ? 1 : current + 1,
      );
    }, 3_000);

    return () => clearInterval(interval);
  }, [prefersReducedMotion]);

  return (
    <Button
      type="button"
      variant="ghost"
      className={sidebarEntryButtonClassName}
      onClick={onClick}
      aria-label="how do i listen on spotify or apple music?"
      aria-current={active ? "page" : undefined}
    >
      <span className="text-xs font-normal text-muted-foreground">how do i listen on</span>
      <span className="relative h-5 w-full overflow-hidden font-semibold">
        <span
          aria-hidden="true"
          className={cn(
            "flex flex-col motion-reduce:transition-none",
            transitionEnabled &&
              !prefersReducedMotion &&
              "transition-transform duration-300 ease-in-out",
          )}
          style={{ transform: `translateY(-${serviceIndex * 1.25}rem)` }}
          onTransitionEnd={() => {
            if (serviceIndex !== listeningGuideServices.length - 1) return;

            setTransitionEnabled(false);
            setServiceIndex(0);
            requestAnimationFrame(() => {
              requestAnimationFrame(() => setTransitionEnabled(true));
            });
          }}
        >
          {listeningGuideServices.map((service, index) => (
            <span
              key={`${service}-${index}`}
              className="flex h-5 shrink-0 items-center justify-center"
            >
              {service}
            </span>
          ))}
        </span>
      </span>
    </Button>
  );
}

export default function TagSidebarPanel({
  loading,
  files,
  albums,
  looseTrackIds,
  selectedAlbumId,
  selectedFileId,
  selectedFileIds,
  cleanupSuggestionCountByAlbumId,
  settingsOpen,
  listeningGuideOpen,
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
  onOpenListeningGuide,
  onCancelPlaylistDownloadQueue,
  onRetryPlaylistDownloadQueue,
}: TagSidebarPanelProps) {
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
      className={cn(
        "order-2 h-svh w-full flex-shrink-0 flex flex-col border-t bg-card overflow-hidden transition-colors duration-200 md:order-none md:h-auto md:min-h-0 md:w-72 md:border-t-0 md:border-r",
        isDraggingFile && "bg-primary/5 shadow-[inset_0_0_0_2px_var(--primary)]",
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
        <div className="grid grid-cols-2 gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block">
                <Button
                  type="button"
                  variant="ghost"
                  className={sidebarIconButtonClassName}
                  onClick={onDownloadAll}
                  disabled={!canDownloadAll || loading}
                  aria-label={loading ? "downloading library" : "download all"}
                >
                  <Download />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {canDownloadAll && !loading ? "download all" : downloadAllReason}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className={sidebarIconButtonClassName}
                onClick={onOpenSettings}
                aria-label="settings"
                aria-current={settingsOpen ? "page" : undefined}
              >
                <Settings />
              </Button>
            </TooltipTrigger>
            <TooltipContent>settings</TooltipContent>
          </Tooltip>
        </div>

        <ListeningGuideEntryButton active={listeningGuideOpen} onClick={onOpenListeningGuide} />
      </div>
    </div>
  );
}
