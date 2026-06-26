"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import AudioUpload from "./audioUpload";
import AudioDownloader from "./AudioDownloader";
import AlbumSidebar from "./AlbumSidebar";
import type { AudioDownloadBitrate } from "./cobaltDownload";
import type { SoundCloudSet } from "./soundcloudSet";
import { AlbumGroup, TagiumFile } from "./types";
import { Button } from "../ui/button";

interface TagSidebarPanelProps {
  loading: boolean;
  files: TagiumFile[];
  albums: AlbumGroup[];
  looseTrackIds: string[];
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
  onAudioUpload: (files: File[]) => void;
  onAudioDownload: (sourceUrl: string, bitrate: AudioDownloadBitrate) => void;
  onSoundCloudSetDownload: (set: SoundCloudSet, bitrate: AudioDownloadBitrate) => void;
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
  onAudioDownload,
  onSoundCloudSetDownload,
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
    <div className="w-full md:w-72 flex-shrink-0 flex flex-col border-b md:border-b-0 md:border-r bg-card overflow-hidden max-h-[45vh] md:max-h-none">
      <div className="h-14 flex items-center px-5 border-b flex-shrink-0">
        <span className="font-bold text-xl tracking-tight select-none">tagium</span>
      </div>

      <div className="px-3 py-3 border-b flex flex-col gap-2 flex-shrink-0">
        <AudioDownloader
          onAudioDownload={onAudioDownload}
          onSoundCloudSetDownload={onSoundCloudSetDownload}
        />
        <AudioUpload onAudioUpload={onAudioUpload} />
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

      <div className="px-3 py-3 border-t flex-shrink-0">
        <Button className="w-full" onClick={onSaveAll} disabled={files.length === 0 || loading}>
          {loading ? "Saving..." : "Save All"}
        </Button>
      </div>
    </div>
  );
}
