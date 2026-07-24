import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createAlbumActionItems } from "@/features/library/albumActionItems";

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setActivatorNodeRef: () => undefined,
    setNodeRef: () => undefined,
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

import { SortableAlbumCard } from "@/features/library/AlbumSidebarDnd";

const noOp = () => {};
const album = {
  id: "album-1",
  title: "Signal",
  artist: "June",
  genre: "Electronic",
  trackIds: ["track-1"],
};

const renderCard = (cleanupSuggestionCount: number) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <SortableAlbumCard
        album={album}
        selected={false}
        canDownload
        cleanupSuggestionCount={cleanupSuggestionCount}
        actions={createAlbumActionItems({
          cleanupSuggestionCount,
          canShare: true,
          shareDisabledReason: "",
          shareLabel: "share album",
          onEdit: noOp,
          onReviewCleanup: noOp,
          onShare: noOp,
        })}
        onSelect={noOp}
        onDownload={noOp}
        onFileDragOver={noOp}
        onFileDrop={noOp}
      >
        <div>tracks</div>
      </SortableAlbumCard>
    </TooltipProvider>,
  );

describe("SortableAlbumCard action menu", () => {
  it("renders a visible, accessible menu trigger outside the album activator", () => {
    const markup = renderCard(0);

    expect(markup).toContain("lucide-ellipsis-vertical");
    expect(markup).toContain('aria-label="album actions for Signal"');
    expect(markup).not.toContain("cleanup suggested");
    expect(markup.match(/<button/g)).toHaveLength(3);
  });

  it("adds a primary dot and non-color aria cue when cleanup is suggested", () => {
    const markup = renderCard(2);

    expect(markup).toContain('aria-label="album actions for Signal, cleanup suggested"');
    expect(markup).toContain("rounded-full bg-primary");
  });
});
