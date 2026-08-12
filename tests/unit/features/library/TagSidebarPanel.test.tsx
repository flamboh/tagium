import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import TagSidebarPanel from "@/features/library/TagSidebarPanel";

vi.mock("@/features/library/AlbumSidebar", () => ({
  default: () => <div data-testid="album-sidebar" />,
}));

vi.mock("@/features/import/PlaylistDownloadQueuePanel", () => ({
  default: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const noOp = () => {};

describe("TagSidebarPanel", () => {
  it("remains visible when the closed mobile drawer is rendered at desktop widths", () => {
    const markup = renderToStaticMarkup(
      <TagSidebarPanel
        loading={false}
        files={[]}
        albums={[]}
        looseTrackIds={[]}
        selectedAlbumId={null}
        selectedFileId={null}
        selectedFileIds={new Set()}
        cleanupSuggestionCountByAlbumId={new Map()}
        settingsOpen={false}
        onAudioUpload={noOp}
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
        onDownloadAll={noOp}
        onOpenSettings={noOp}
        onGoHome={noOp}
      />,
    );

    expect(markup).toContain("md:visible");
    expect(markup).toContain("md:opacity-100");
    expect(markup).toContain("md:translate-x-0");
    expect(markup).toContain('aria-label="tagium, go to workspace home"');
  });
});
