"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import AudioUpload from "./audioUpload";
import AudioDownloader from "./AudioDownloader";
import AlbumSidebar from "./AlbumSidebar";
import { AlbumGroup, ImportedAlbumMetadata, TagiumFile } from "./types";
import { Button } from "../ui/button";
import { Card, CardHeader } from "@/components/ui/card";

interface TagSidebarPanelProps {
  loading: boolean;
  files: TagiumFile[];
  albums: AlbumGroup[];
  looseTrackIds: string[];
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
  onAudioUpload: (files: File[]) => void;
  onAlbumDownload: (files: File[], album: ImportedAlbumMetadata) => void;
  onSelectAlbum: (albumId: string, event?: ReactMouseEvent) => void;
  onSelectFile: (albumId: string, fileId: string, event?: ReactMouseEvent) => void;
  onSelectLooseTrack: (fileId: string, event?: ReactMouseEvent) => void;
  onClearSelection: () => void;
  onRemoveFile: (fileId: string) => void;
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
  onSaveAll: () => void;
}

export default function TagSidebarPanel({
  loading,
  files,
  albums,
  looseTrackIds,
  selectedAlbumId,
  selectedFileId,
  selectedFileIds,
  onAudioUpload,
  onAlbumDownload,
  onSelectAlbum,
  onSelectFile,
  onSelectLooseTrack,
  onClearSelection,
  onRemoveFile,
  onAddAlbum,
  onEditAlbum,
  onDownloadAlbum,
  onUploadToAlbum,
  onMoveTrackToAlbum,
  onMoveTrackToLoose,
  onPromptCreateAlbumFromLooseTracks,
  onReorderAlbums,
  onSaveAll,
}: TagSidebarPanelProps) {
  return (
    <div className="w-80 flex-shrink-0 flex flex-col gap-4">
      <Card className="h-full flex flex-col overflow-hidden py-0 gap-2">
        <CardHeader className="p-6 border-b gap-3">
          <AudioDownloader onAudioUpload={onAudioUpload} onAlbumDownload={onAlbumDownload} />
          <AudioUpload onAudioUpload={onAudioUpload} />
        </CardHeader>
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
        <div className="p-6 border-t mt-auto">
          <Button className="w-full" onClick={onSaveAll} disabled={files.length === 0 || loading}>
            {loading ? "Saving..." : "Save All"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
