"use client";

import AudioUpload from "./audioUpload";
import AlbumSidebar from "./AlbumSidebar";
import { AlbumGroup, TagiumFile } from "./types";
import { Button } from "../ui/button";
import { Card, CardHeader } from "@/components/ui/card";

interface TagSidebarPanelProps {
  loading: boolean;
  files: TagiumFile[];
  albums: AlbumGroup[];
  looseTrackIds: string[];
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  onAudioUpload: (files: File[]) => void;
  onSelectAlbum: (albumId: string) => void;
  onSelectFile: (albumId: string, fileId: string) => void;
  onSelectLooseTrack: (fileId: string) => void;
  onRemoveFile: (fileId: string) => void;
  onRemoveAlbum: (albumId: string) => void;
  onAddAlbum: () => void;
  onEditAlbum: (albumId: string) => void;
  onMoveTrackToAlbum: (
    trackId: string,
    targetAlbumId: string,
    targetIndex: number
  ) => void;
  onMoveTrackToLoose: (trackId: string, targetIndex: number) => void;
  onPromptCreateAlbumFromLooseTracks: (
    sourceTrackId: string,
    targetTrackId: string
  ) => void;
  onSaveAll: () => void;
}

export default function TagSidebarPanel({
  loading,
  files,
  albums,
  looseTrackIds,
  selectedAlbumId,
  selectedFileId,
  onAudioUpload,
  onSelectAlbum,
  onSelectFile,
  onSelectLooseTrack,
  onRemoveFile,
  onRemoveAlbum,
  onAddAlbum,
  onEditAlbum,
  onMoveTrackToAlbum,
  onMoveTrackToLoose,
  onPromptCreateAlbumFromLooseTracks,
  onSaveAll,
}: TagSidebarPanelProps) {
  return (
    <div className="w-80 flex-shrink-0 flex flex-col gap-4">
      <Card className="h-full flex flex-col overflow-hidden py-0 gap-2">
        <CardHeader className="p-6 border-b h-[104px]">
          <AudioUpload onAudioUpload={onAudioUpload} />
        </CardHeader>
        <AlbumSidebar
          albums={albums}
          looseTrackIds={looseTrackIds}
          files={files}
          selectedAlbumId={selectedAlbumId}
          selectedFileId={selectedFileId}
          onSelectAlbum={onSelectAlbum}
          onSelectFile={onSelectFile}
          onSelectLooseTrack={onSelectLooseTrack}
          onRemoveFile={onRemoveFile}
          onRemoveAlbum={onRemoveAlbum}
          onAddAlbum={onAddAlbum}
          onEditAlbum={onEditAlbum}
          onMoveTrackToAlbum={onMoveTrackToAlbum}
          onMoveTrackToLoose={onMoveTrackToLoose}
          onPromptCreateAlbumFromLooseTracks={onPromptCreateAlbumFromLooseTracks}
        />
        <div className="p-6 border-t mt-auto">
          <Button
            className="w-full"
            onClick={onSaveAll}
            disabled={files.length === 0 || loading}
          >
            {loading ? "Saving..." : "Save All"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
