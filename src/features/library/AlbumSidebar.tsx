"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlbumSidebarEmptyState } from "@/features/library/AlbumSidebarEmptyState";
import {
  DroppableTrackContainer,
  SidebarDragPreview,
  SortableAlbumCard,
  SortableTrackRow,
} from "@/features/library/AlbumSidebarDnd";
import {
  albumContainerId,
  albumItemId,
  LOOSE_APPEND_CONTAINER_ID,
  LOOSE_CONTAINER_ID,
  trackItemId,
} from "@/features/library/sidebarDnd";
import type { AlbumGroup, TagiumFile } from "@/features/library/types";
import { isTrackReadyForDownload } from "@/features/export/downloadLibrary";
import { useAlbumSidebarDragController } from "@/features/library/useAlbumSidebarDragController";

interface AlbumSidebarProps {
  albums: AlbumGroup[];
  looseTrackIds: string[];
  files: TagiumFile[];
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
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
  onAudioUpload: (files: File[]) => void;
}

const isRetryableError = (track: TagiumFile) =>
  Boolean(track.downloadRequest) &&
  (track.downloadStatus === "error" ||
    track.downloadStatus === "canceled" ||
    track.status === "error");

export default function AlbumSidebar({
  albums,
  looseTrackIds,
  files,
  selectedAlbumId,
  selectedFileId,
  selectedFileIds,
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
  onAudioUpload,
}: AlbumSidebarProps) {
  const filesById = new Map(files.map((file) => [file.id, file]));
  const looseTracks = looseTrackIds
    .map((trackId) => filesById.get(trackId))
    .filter((track): track is TagiumFile => Boolean(track));
  const { activeDrag, dndContextProps, libraryFileDropProps, albumFileDropProps } =
    useAlbumSidebarDragController({
      albums,
      looseTrackIds,
      onMoveTrackToAlbum,
      onMoveTrackToLoose,
      onPromptCreateAlbumFromLooseTracks,
      onReorderAlbums,
      onAudioUpload,
      onUploadToAlbum,
    });
  const activeTrack = activeDrag?.type === "track" ? filesById.get(activeDrag.trackId) : undefined;
  const activeAlbum =
    activeDrag?.type === "album"
      ? albums.find((album) => album.id === activeDrag.albumId)
      : undefined;

  const selectedTone = (trackId: string) => {
    if (selectedFileIds.has(trackId)) return "primary";
    if (selectedFileId === trackId) return "secondary";
    return null;
  };

  if (albums.length === 0 && looseTracks.length === 0) {
    return <AlbumSidebarEmptyState onAddAlbum={onAddAlbum} onClearSelection={onClearSelection} />;
  }

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col">
      <div className="h-12 px-4 border-b flex items-center justify-between flex-shrink-0">
        <span className="font-semibold text-sm leading-none text-muted-foreground">
          library ({files.length})
        </span>
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onAddAlbum}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <DndContext {...dndContextProps}>
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col"
          {...libraryFileDropProps}
        >
          <SortableContext
            items={looseTracks.map((track) => trackItemId(track.id))}
            strategy={verticalListSortingStrategy}
          >
            <DroppableTrackContainer
              id={LOOSE_CONTAINER_ID}
              data={{ type: "container", container: "loose" }}
              className={looseTracks.length === 0 ? "min-h-0 shrink-0" : "shrink-0"}
            >
              {looseTracks.map((track) => (
                <SortableTrackRow
                  key={track.id}
                  track={track}
                  container="loose"
                  selectedTone={selectedTone(track.id)}
                  muted={track.downloadStatus === "downloading"}
                  retryable={isRetryableError(track)}
                  onSelect={(event) => onSelectLooseTrack(track.id, event)}
                  onRetry={() => onRetryDownload(track.id)}
                  onRemove={() => onRemoveFile(track.id)}
                />
              ))}
            </DroppableTrackContainer>
          </SortableContext>

          <SortableContext
            items={albums.map((album) => albumItemId(album.id))}
            strategy={verticalListSortingStrategy}
          >
            {albums.map((album) => {
              const canDownloadAlbum =
                album.trackIds.length > 0 &&
                album.trackIds.every((trackId) => {
                  const file = filesById.get(trackId);
                  return file ? isTrackReadyForDownload(file) : false;
                });
              const fileDropProps = albumFileDropProps(album.id);
              return (
                <SortableAlbumCard
                  key={album.id}
                  album={album}
                  selected={selectedAlbumId === album.id}
                  canDownload={canDownloadAlbum}
                  onSelect={(event) => onSelectAlbum(album.id, event)}
                  onEdit={() => onEditAlbum(album.id)}
                  onDownload={() => onDownloadAlbum(album.id)}
                  {...fileDropProps}
                >
                  <SortableContext
                    items={album.trackIds.map((trackId) => trackItemId(trackId))}
                    strategy={verticalListSortingStrategy}
                  >
                    <DroppableTrackContainer
                      id={albumContainerId(album.id)}
                      data={{ type: "container", container: "album", albumId: album.id }}
                      className="min-h-8"
                    >
                      {album.trackIds.length === 0 ? (
                        <div className="text-xs text-muted-foreground px-4 py-3 text-center">
                          drag tracks here
                        </div>
                      ) : (
                        album.trackIds.map((trackId, index) => {
                          const track = filesById.get(trackId);
                          if (!track) return null;

                          return (
                            <SortableTrackRow
                              key={track.id}
                              track={track}
                              index={index + 1}
                              container="album"
                              albumId={album.id}
                              selectedTone={selectedTone(track.id)}
                              muted={track.downloadStatus === "downloading"}
                              retryable={isRetryableError(track)}
                              onSelect={(event) => onSelectFile(album.id, track.id, event)}
                              onRetry={() => onRetryDownload(track.id)}
                              onRemove={() => onRemoveFile(track.id)}
                            />
                          );
                        })
                      )}
                    </DroppableTrackContainer>
                  </SortableContext>
                </SortableAlbumCard>
              );
            })}
          </SortableContext>
          <DroppableTrackContainer
            id={LOOSE_APPEND_CONTAINER_ID}
            data={{ type: "container", container: "loose" }}
            className="flex-1 min-h-16"
          >
            <button
              type="button"
              tabIndex={-1}
              aria-label="clear track selection and return to editor"
              className="min-h-16 flex-1 cursor-default"
              onClick={onClearSelection}
            />
          </DroppableTrackContainer>
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDrag ? (
            <SidebarDragPreview active={activeDrag} album={activeAlbum} track={activeTrack} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
