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
  SortableAlbumCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
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
        onSelectAlbum={noOp}
        onSelectFile={noOp}
        onSelectLooseTrack={noOp}
        onClearSelection={noOp}
        onRemoveFile={noOp}
        onRetryDownload={noOp}
        onAddAlbum={noOp}
        onEditAlbum={noOp}
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
});
