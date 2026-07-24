import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { TooltipProvider } from "@/components/ui/tooltip";

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

const renderCard = (shareLabel: "share album" | "view share link" | "update shared album") =>
  renderToStaticMarkup(
    <TooltipProvider>
      <SortableAlbumCard
        album={album}
        selected={false}
        canDownload
        canShare
        shareDisabledReason=""
        shareLabel={shareLabel}
        onSelect={noOp}
        onEdit={noOp}
        onDownload={noOp}
        onShare={noOp}
        onFileDragOver={noOp}
        onFileDrop={noOp}
      >
        <div>tracks</div>
      </SortableAlbumCard>
    </TooltipProvider>,
  );

describe("SortableAlbumCard sharing state", () => {
  it("uses the standard share affordance before an album is published", () => {
    const markup = renderCard("share album");

    expect(markup).toContain("lucide-share-2");
    expect(markup).toContain('aria-label="share album: Signal"');
  });

  it("uses the standard untinted link affordance for an active publication", () => {
    const markup = renderCard("view share link");

    expect(markup).toContain("lucide-link-2");
    expect(markup).toContain('aria-label="view share link: Signal"');
    expect(markup).not.toContain("bg-primary/8");
    expect(markup).not.toContain("text-primary");
  });
});
