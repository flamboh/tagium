import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import AlbumSidebar from "@/features/library/AlbumSidebar";
import { LOOSE_CONTAINER_ID } from "@/features/library/sidebarDnd";

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
  SortableAlbumCard: ({
    children,
    hasCleanupSuggestions,
  }: {
    children?: ReactNode;
    hasCleanupSuggestions: boolean;
  }) => (
    <div data-cleanup-suggestions={hasCleanupSuggestions ? "available" : "none"}>{children}</div>
  ),
  SortableTrackRow: () => null,
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

describe("AlbumSidebar", () => {
  it("does not add height to an empty loose area during a track drag", () => {
    const markup = renderToStaticMarkup(
      <AlbumSidebar
        albums={[{ id: "album-a", title: "Album A", artist: "Artist", genre: "", trackIds: [] }]}
        looseTrackIds={[]}
        files={[]}
        selectedAlbumId={null}
        selectedFileId={null}
        selectedFileIds={new Set()}
        albumIdsWithCleanupSuggestions={new Set()}
        onSelectAlbum={noOp}
        onSelectFile={noOp}
        onSelectLooseTrack={noOp}
        onClearSelection={noOp}
        onRemoveFile={noOp}
        onRetryDownload={noOp}
        onAddAlbum={noOp}
        onEditAlbum={noOp}
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

  it("marks only albums with derived cleanup suggestions", () => {
    const markup = renderToStaticMarkup(
      <AlbumSidebar
        albums={[
          { id: "album-a", title: "Album A", artist: "Artist", genre: "", trackIds: [] },
          { id: "album-b", title: "Album B", artist: "Artist", genre: "", trackIds: [] },
        ]}
        looseTrackIds={[]}
        files={[]}
        selectedAlbumId={null}
        selectedFileId={null}
        selectedFileIds={new Set()}
        albumIdsWithCleanupSuggestions={new Set(["album-b"])}
        onSelectAlbum={noOp}
        onSelectFile={noOp}
        onSelectLooseTrack={noOp}
        onClearSelection={noOp}
        onRemoveFile={noOp}
        onRetryDownload={noOp}
        onAddAlbum={noOp}
        onEditAlbum={noOp}
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

    expect(markup.match(/data-cleanup-suggestions="available"/g)).toHaveLength(1);
    expect(markup.match(/data-cleanup-suggestions="none"/g)).toHaveLength(1);
  });
});
