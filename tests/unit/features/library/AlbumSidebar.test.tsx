import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import AlbumSidebar from "@/features/library/AlbumSidebar";
import { LOOSE_CONTAINER_ID } from "@/features/library/sidebarDnd";
import type { TrackActionItem } from "@/features/library/trackActionItems";
import { createTrackFilenamePreviewStore } from "@/features/library/trackFilenamePreview";

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children?: ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: "vertical-list",
}));

vi.mock("@/features/library/AlbumSidebarDnd", () => ({
  DroppableTrackContainer: ({
    children,
    className,
    id,
  }: {
    children?: ReactNode;
    className?: string;
    id: string;
  }) => (
    <div data-drop-container={id} className={className}>
      {children}
    </div>
  ),
  SidebarDragPreview: () => null,
  SortableAlbumCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SortableTrackRow: ({
    track,
    container,
    actions,
  }: {
    track: { id: string };
    container: "album" | "loose";
    actions: TrackActionItem[];
  }) => (
    <div
      data-track-id={track.id}
      data-track-container={container}
      data-track-actions={actions.map(({ label }) => label).join(":")}
    />
  ),
}));

vi.mock("@/features/library/useAlbumSidebarDragController", () => ({
  useAlbumSidebarDragController: () => ({
    activeDrag: { type: "track", trackId: "album-track", container: "album", albumId: "album-a" },
    dndContextProps: {},
    libraryFileDropProps: {},
    albumFileDropProps: () => ({ onFileDragOver: () => {}, onFileDrop: () => {} }),
  }),
}));

const noOp = () => {};
const filenamePreviewStore = createTrackFilenamePreviewStore();

describe("AlbumSidebar", () => {
  it("does not add height to an empty loose area during a track drag", () => {
    const markup = renderToStaticMarkup(
      <AlbumSidebar
        albums={[{ id: "album-a", title: "Album A", artist: "Artist", genre: "", trackIds: [] }]}
        looseTrackIds={[]}
        files={[]}
        filenamePreviewStore={filenamePreviewStore}
        selectedAlbumId={null}
        selectedFileId={null}
        selectedFileIds={new Set()}
        cleanupSuggestionCountByAlbumId={new Map()}
        onSelectAlbum={noOp}
        onSelectFile={noOp}
        onSelectLooseTrack={noOp}
        onClearSelection={noOp}
        onRemoveFile={noOp}
        onRetryDownload={noOp}
        onAddAlbum={noOp}
        onEditAlbum={noOp}
        onDeleteAlbum={noOp}
        onReviewAlbumCleanup={noOp}
        onDownloadAlbum={noOp}
        onUploadToAlbum={noOp}
        onMoveTrackToAlbum={noOp}
        onMoveTrackToLoose={noOp}
        onPromptCreateAlbumFromLooseTracks={noOp}
        onReorderAlbums={noOp}
        onAudioUpload={noOp}
      />,
    );

    expect(markup).toContain(
      `data-drop-container="${LOOSE_CONTAINER_ID}" class="min-h-0 shrink-0"`,
    );
    expect(markup).not.toContain("min-h-12");
  });

  it("builds the same ordered action menu for loose and album tracks", () => {
    const markup = renderToStaticMarkup(
      <AlbumSidebar
        albums={[
          {
            id: "album-a",
            title: "Album A",
            artist: "Artist",
            genre: "",
            trackIds: ["album-track"],
          },
        ]}
        looseTrackIds={["loose-track"]}
        files={[
          {
            id: "loose-track",
            filename: "loose.mp3",
            status: "error",
            downloadStatus: "error",
            downloadRequest: { sourceUrl: "https://example.com/loose", audioBitrate: "320" },
          },
          {
            id: "album-track",
            filename: "album.mp3",
            status: "saved",
            downloadStatus: "ready",
          },
        ]}
        filenamePreviewStore={filenamePreviewStore}
        selectedAlbumId={null}
        selectedFileId={null}
        selectedFileIds={new Set()}
        cleanupSuggestionCountByAlbumId={new Map()}
        onSelectAlbum={noOp}
        onSelectFile={noOp}
        onSelectLooseTrack={noOp}
        onClearSelection={noOp}
        onRemoveFile={noOp}
        onRetryDownload={noOp}
        onAddAlbum={noOp}
        onEditAlbum={noOp}
        onDeleteAlbum={noOp}
        onReviewAlbumCleanup={noOp}
        onDownloadAlbum={noOp}
        onShareTrack={noOp}
        shareTrackActions={{
          "loose-track": {
            enabled: true,
            label: "view share link",
            reason: "view share link",
            variant: "view",
          },
          "album-track": {
            enabled: true,
            label: "view share link",
            reason: "view share link",
            variant: "view",
          },
        }}
        onUploadToAlbum={noOp}
        onMoveTrackToAlbum={noOp}
        onMoveTrackToLoose={noOp}
        onPromptCreateAlbumFromLooseTracks={noOp}
        onReorderAlbums={noOp}
        onAudioUpload={noOp}
      />,
    );

    expect(markup).toContain(
      'data-track-id="loose-track" data-track-container="loose" data-track-actions="retry download:view share link:remove track"',
    );
    expect(markup).toContain(
      'data-track-id="album-track" data-track-container="album" data-track-actions="view share link:remove track"',
    );
  });
});
