"use client";

import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AnimatePresence } from "motion/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
import type { ShareActionState } from "@/features/share/sharePublication";
import { createAlbumActionItems } from "@/features/library/albumActionItems";
import { createTrackActionItems } from "@/features/library/trackActionItems";
import type { TrackFilenamePreviewStore } from "@/features/library/trackFilenamePreview";

interface AlbumSidebarProps {
  albums: AlbumGroup[];
  looseTrackIds: string[];
  files: TagiumFile[];
  filenamePreviewStore: TrackFilenamePreviewStore;
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
  cleanupSuggestionCountByAlbumId: ReadonlyMap<string, number>;
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
  filenamePreviewStore,
  selectedAlbumId,
  selectedFileId,
  selectedFileIds,
  cleanupSuggestionCountByAlbumId,
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
  shareAlbumActions = {},
  onShareTrack,
  shareTrackActions = {},
  onUploadToAlbum,
  onMoveTrackToAlbum,
  onMoveTrackToLoose,
  onPromptCreateAlbumFromLooseTracks,
  onReorderAlbums,
  onAudioUpload,
}: AlbumSidebarProps) {
  // Ids present on first render are pre-seeded so an already populated library does not animate.
  const [seenIds] = useState(
    () => new Set([...files.map((file) => file.id), ...albums.map((album) => album.id)]),
  );
  // Rows are marked seen after commit, so a row only animates on the render that first mounts it
  // (StrictMode's double render would otherwise mark it seen before it ever appears).
  useEffect(() => {
    for (const file of files) seenIds.add(file.id);
    for (const album of albums) seenIds.add(album.id);
  });
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

  const actionsForTrack = (track: TagiumFile) => {
    const shareAction = shareTrackActions[track.id];
    const shareVariant = shareAction?.variant ?? "create";
    const contentCanShare = Boolean(track.downloadRequest && track.metadata);
    const canShareTrack =
      Boolean(onShareTrack) &&
      (shareVariant === "view" || contentCanShare) &&
      (shareAction?.enabled ?? true);
    const contentDisabledReason = track.downloadRequest
      ? "track metadata is still loading"
      : "local tracks cannot be shared";
    const shareDisabledReason =
      shareAction?.reason ??
      (onShareTrack ? contentDisabledReason : "track sharing is unavailable");

    return createTrackActionItems({
      retryable: isRetryableError(track),
      canShare: canShareTrack,
      shareDisabledReason,
      shareLabel: shareAction?.label ?? "share track",
      shareVariant,
      onRetry: () => onRetryDownload(track.id),
      onShare: () => onShareTrack?.(track.id),
      onRemove: () => onRemoveFile(track.id),
    });
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 [@media(pointer:coarse)]:size-11"
          onClick={onAddAlbum}
          aria-label="add album"
        >
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="h-4 w-4" />
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
              {looseTracks.map((track) => {
                const animateEnter = !seenIds.has(track.id);
                return (
                  <SortableTrackRow
                    key={track.id}
                    track={track}
                    filenamePreviewStore={filenamePreviewStore}
                    container="loose"
                    selectedTone={selectedTone(track.id)}
                    muted={track.downloadStatus === "downloading"}
                    actions={actionsForTrack(track)}
                    animateEnter={animateEnter}
                    onSelect={(event) => onSelectLooseTrack(track.id, event)}
                  />
                );
              })}
            </DroppableTrackContainer>
          </SortableContext>

          <SortableContext
            items={albums.map((album) => albumItemId(album.id))}
            strategy={verticalListSortingStrategy}
          >
            <AnimatePresence initial={false}>
              {albums.map((album) => {
                // A new album grows in as one block, so its tracks must not run their own entrance
                // (they would be mid-animation at zero height when the album measures itself).
                const animateEnter = !seenIds.has(album.id);
                const canDownloadAlbum =
                  album.trackIds.length > 0 &&
                  album.trackIds.every((trackId) => {
                    const file = filesById.get(trackId);
                    return file ? isTrackReadyForDownload(file) : false;
                  });
                const shareableTracks = album.trackIds.map((trackId) => filesById.get(trackId));
                const contentCanShare =
                  shareableTracks.length > 0 &&
                  shareableTracks.every((file) => Boolean(file?.downloadRequest && file.metadata));
                const contentDisabledReason =
                  album.trackIds.length === 0
                    ? "add imported tracks first"
                    : "albums with local tracks cannot be shared";
                const shareAction = shareAlbumActions[album.id];
                const retrievesExistingLink = shareAction?.variant === "view";
                const canShareAlbum =
                  Boolean(onShareAlbum) &&
                  (retrievesExistingLink || contentCanShare) &&
                  (shareAction?.enabled ?? true);
                const shareDisabledReason = shareAction?.reason ?? contentDisabledReason;
                const cleanupSuggestionCount = cleanupSuggestionCountByAlbumId.get(album.id) ?? 0;
                const actions = createAlbumActionItems({
                  cleanupSuggestionCount,
                  canShare: canShareAlbum,
                  shareDisabledReason,
                  shareLabel: shareAction?.label ?? "share album",
                  shareVariant: shareAction?.variant ?? "create",
                  onEdit: () => onEditAlbum(album.id),
                  onReviewCleanup: ({ returnFocusTarget }) =>
                    onReviewAlbumCleanup(album.id, returnFocusTarget),
                  onShare: () => onShareAlbum?.(album.id),
                  onDelete: ({ returnFocusTarget }) => onDeleteAlbum(album.id, returnFocusTarget),
                });
                const fileDropProps = albumFileDropProps(album.id);
                return (
                  <SortableAlbumCard
                    key={album.id}
                    album={album}
                    selected={selectedAlbumId === album.id}
                    canDownload={canDownloadAlbum}
                    cleanupSuggestionCount={cleanupSuggestionCount}
                    actions={actions}
                    animateEnter={animateEnter}
                    onSelect={(event) => onSelectAlbum(album.id, event)}
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
                            const animateTrackEnter = !animateEnter && !seenIds.has(track.id);

                            return (
                              <SortableTrackRow
                                key={track.id}
                                track={track}
                                filenamePreviewStore={filenamePreviewStore}
                                index={index + 1}
                                container="album"
                                albumId={album.id}
                                selectedTone={selectedTone(track.id)}
                                muted={track.downloadStatus === "downloading"}
                                actions={actionsForTrack(track)}
                                animateEnter={animateTrackEnter}
                                onSelect={(event) => onSelectFile(album.id, track.id, event)}
                              />
                            );
                          })
                        )}
                      </DroppableTrackContainer>
                    </SortableContext>
                  </SortableAlbumCard>
                );
              })}
            </AnimatePresence>
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
