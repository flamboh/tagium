"use client";

import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import AlbumSidebar from "@/features/library/AlbumSidebar";
import PlaylistDownloadQueuePanel, {
  type PlaylistDownloadQueuePanelState,
} from "@/features/import/PlaylistDownloadQueuePanel";
import { AlbumGroup, TagiumFile } from "@/features/library/types";
import type { ShareActionState } from "@/features/share/sharePublication";
import type { ShareLinkSpotlightTarget } from "@/features/share/useShareLinkSpotlight";
import type { TrackFilenamePreviewStore } from "@/features/library/trackFilenamePreview";
import TagSidebarHeader from "@/features/library/TagSidebarHeader";
import TagSidebarFooter from "@/features/library/TagSidebarFooter";

export interface TagSidebarPanelProps {
  mobileOpen?: boolean;
  mobileDrawerRef?: RefObject<HTMLDivElement | null>;
  onMobileClose?: () => void;
  loading: boolean;
  files: TagiumFile[];
  filenamePreviewStore: TrackFilenamePreviewStore;
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
  onDeleteAlbum: (albumId: string, returnFocusTarget: HTMLButtonElement | null) => void;
  onReviewAlbumCleanup: (albumId: string, returnFocusTarget: HTMLButtonElement | null) => void;
  onDownloadAlbum: (albumId: string) => void;
  onShareAlbum?: (albumId: string) => void;
  shareAlbumActions?: Readonly<Record<string, ShareActionState>>;
  onShareTrack?: (trackId: string) => void;
  shareTrackActions?: Readonly<Record<string, ShareActionState>>;
  shareSpotlight?: ShareLinkSpotlightTarget | null;
  onShareSpotlightDismiss?: () => void;
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
  onGoHome: () => void;
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
  filenamePreviewStore,
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
  onDeleteAlbum,
  onReviewAlbumCleanup,
  onDownloadAlbum,
  onShareAlbum,
  shareAlbumActions,
  onShareTrack,
  shareTrackActions,
  shareSpotlight,
  onShareSpotlightDismiss,
  onUploadToAlbum,
  onMoveTrackToAlbum,
  onMoveTrackToLoose,
  onPromptCreateAlbumFromLooseTracks,
  onReorderAlbums,
  playlistDownloadQueue = null,
  onDownloadAll,
  onOpenSettings,
  onGoHome,
  onCancelPlaylistDownloadQueue,
  onRetryPlaylistDownloadQueue,
}: TagSidebarPanelProps) {
  const dragCounterRef = useRef(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

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
        `order-2 h-svh w-full flex-shrink-0 flex flex-col border-t bg-background text-foreground overflow-hidden ${MOBILE_DRAWER_TRANSITION_CLASSES} md:page-slide-in md:order-none md:h-auto md:min-h-0 md:w-72 md:translate-x-0 md:border-t-0 md:border-r`,
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
      <TagSidebarHeader mobileOpen={mobileOpen} onMobileClose={onMobileClose} onGoHome={onGoHome} />

      <AlbumSidebar
        albums={albums}
        looseTrackIds={looseTrackIds}
        files={files}
        filenamePreviewStore={filenamePreviewStore}
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
        onDeleteAlbum={onDeleteAlbum}
        onReviewAlbumCleanup={onReviewAlbumCleanup}
        onDownloadAlbum={onDownloadAlbum}
        onShareAlbum={onShareAlbum}
        shareAlbumActions={shareAlbumActions}
        onShareTrack={onShareTrack}
        shareTrackActions={shareTrackActions}
        shareSpotlight={shareSpotlight}
        onShareSpotlightDismiss={onShareSpotlightDismiss}
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

      <TagSidebarFooter
        files={files}
        loading={loading}
        settingsOpen={settingsOpen}
        onDownloadAll={onDownloadAll}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}
