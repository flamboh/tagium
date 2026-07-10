"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useRef, useState } from "react";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import AlbumSidebar from "./AlbumSidebar";
import PlaylistDownloadQueuePanel, {
  type PlaylistDownloadQueuePanelState,
} from "./PlaylistDownloadQueuePanel";
import { AlbumGroup, TagiumFile } from "./types";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { allTracksReadyForDownload } from "./downloadLibrary";
import { isValidFilenameBase } from "./filename";

interface TagSidebarPanelProps {
  loading: boolean;
  files: TagiumFile[];
  albums: AlbumGroup[];
  looseTrackIds: string[];
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
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
}

export default function TagSidebarPanel({
  loading,
  files,
  albums,
  looseTrackIds,
  selectedAlbumId,
  selectedFileId,
  selectedFileIds,
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

  const isFileDrag = (event: React.DragEvent<HTMLDivElement>) =>
    event.dataTransfer.types.includes("Files");

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
    const audioFiles = files.filter((file) => file.type.startsWith("audio/"));
    if (audioFiles.length > 0) {
      onAudioUpload(audioFiles);
    }
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
        onSelectAlbum={onSelectAlbum}
        onSelectFile={onSelectFile}
        onSelectLooseTrack={onSelectLooseTrack}
        onClearSelection={onClearSelection}
        onRemoveFile={onRemoveFile}
        onRetryDownload={onRetryDownload}
        onAddAlbum={onAddAlbum}
        onEditAlbum={onEditAlbum}
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

      <div className="px-3 py-3 border-t flex-shrink-0 flex flex-col gap-2">
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
