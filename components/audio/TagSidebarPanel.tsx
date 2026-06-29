"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useRef, useState } from "react";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import AlbumSidebar from "./AlbumSidebar";
import { AlbumGroup, AudioProgress, TagiumFile } from "./types";
import { Button } from "../ui/button";

interface TagSidebarPanelProps {
  loading: boolean;
  exportProgress?: AudioProgress;
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
  onDownloadAll: () => void;
  onOpenSettings: () => void;
}

export default function TagSidebarPanel({
  loading,
  exportProgress,
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
  onDownloadAll,
  onOpenSettings,
}: TagSidebarPanelProps) {
  const dragCounterRef = useRef(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const canDownloadAll = files.length > 0 && files.every((file) => file.file && file.metadata);
  let exportProgressPercent: number | null = null;
  let exportProgressBarWidth = "100%";
  if (
    exportProgress &&
    exportProgress.value !== undefined &&
    exportProgress.max !== undefined &&
    exportProgress.max > 0
  ) {
    exportProgressPercent = Math.min(
      100,
      Math.max(0, Math.round((exportProgress.value / exportProgress.max) * 100)),
    );
    exportProgressBarWidth = `${exportProgressPercent}%`;
  }
  const exportProgressValueProps =
    exportProgressPercent === null
      ? {}
      : {
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": exportProgressPercent,
        };

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
        "order-2 min-h-screen w-full flex-shrink-0 flex flex-col border-t bg-card overflow-hidden transition-colors duration-200 md:order-none md:min-h-0 md:w-72 md:border-t-0 md:border-r",
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
        downloadDisabled={loading}
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

      <div className="px-3 py-3 border-t flex-shrink-0 flex flex-col gap-2">
        <Button className="w-full" onClick={onDownloadAll} disabled={!canDownloadAll || loading}>
          {loading ? "downloading..." : "download all"}
        </Button>
        {exportProgress && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <div
              role="progressbar"
              aria-label="export progress"
              aria-valuetext={exportProgress.label ?? "exporting"}
              {...exportProgressValueProps}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={`h-full rounded-full bg-primary ${exportProgressPercent === null ? "animate-pulse" : ""}`}
                style={{ width: exportProgressBarWidth }}
              />
            </div>
            <span className="shrink-0">
              {exportProgress.label}
              {!exportProgress.label && exportProgressPercent !== null
                ? `${exportProgressPercent}%`
                : ""}
              {!exportProgress.label && exportProgressPercent === null ? "exporting" : ""}
            </span>
          </div>
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
