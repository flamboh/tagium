import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createAlbumActionItems } from "@/features/library/albumActionItems";
import { createTrackActionItems } from "@/features/library/trackActionItems";
import type { TagiumFile } from "@/features/library/types";

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

import {
  AlbumActionItemContent,
  SortableAlbumCard,
  SortableTrackRow,
  TrackActionItemContent,
} from "@/features/library/AlbumSidebarDnd";

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
          shareVariant: "create",
          onEdit: noOp,
          onReviewCleanup: noOp,
          onShare: noOp,
          onDelete: noOp,
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

  it("renders cleanup as a single-line brush action with trailing track metadata", () => {
    const cleanupAction = createAlbumActionItems({
      cleanupSuggestionCount: 2,
      canShare: true,
      shareDisabledReason: "",
      shareLabel: "share album",
      shareVariant: "create",
      onEdit: noOp,
      onReviewCleanup: noOp,
      onShare: noOp,
      onDelete: noOp,
    })[1];
    const markup = renderToStaticMarkup(<AlbumActionItemContent action={cleanupAction} />);

    expect(markup).toContain("lucide-brush-cleaning");
    expect(markup).toContain("clean up tracks");
    expect(markup).toContain("tabular-nums");
    expect(markup).toContain(">2 tracks</span>");
    expect(markup).not.toContain("flex-col");
  });

  it("renders deletion with the destructive trash treatment", () => {
    const deleteAction = createAlbumActionItems({
      cleanupSuggestionCount: 0,
      canShare: true,
      shareDisabledReason: "",
      shareLabel: "share album",
      shareVariant: "create",
      onEdit: noOp,
      onReviewCleanup: noOp,
      onShare: noOp,
      onDelete: noOp,
    })[3];
    const markup = renderToStaticMarkup(<AlbumActionItemContent action={deleteAction} />);

    expect(markup).toContain("lucide-trash-2");
    expect(markup).toContain("text-destructive");
    expect(markup).toContain("delete album");
  });
});

describe("SortableTrackRow action menu", () => {
  const track = {
    id: "track-1",
    filename: "Night Drive.mp3",
    status: "saved",
    downloadStatus: "ready",
  } as TagiumFile;
  const actions = createTrackActionItems({
    retryable: false,
    canShare: true,
    shareDisabledReason: "",
    shareLabel: "share track",
    shareVariant: "create",
    onRetry: noOp,
    onShare: noOp,
    onRemove: noOp,
  });

  it("renders one row-action trigger outside the draggable track button", () => {
    const markup = renderToStaticMarkup(
      <SortableTrackRow
        track={track}
        container="loose"
        selectedTone={null}
        muted={false}
        actions={actions}
        onSelect={noOp}
      />,
    );

    expect(markup).toContain('aria-label="track actions for Night Drive.mp3"');
    expect(markup).toContain("group-focus-within:opacity-100");
    expect(markup).toContain("[@media(pointer:coarse)]:size-11");
    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).not.toContain('aria-label="remove track"');
    expect(markup).not.toContain("retry download for");
  });

  it("chooses the share icon from the explicit action variant", () => {
    const createMarkup = renderToStaticMarkup(
      <TrackActionItemContent
        action={{ ...actions[0], label: "update shared track", shareVariant: "create" }}
      />,
    );
    const viewMarkup = renderToStaticMarkup(
      <TrackActionItemContent
        action={{ ...actions[0], label: "share track", shareVariant: "view" }}
      />,
    );

    expect(createMarkup).toContain("lucide-share-2");
    expect(createMarkup).not.toContain("lucide-link-2");
    expect(viewMarkup).toContain("lucide-link-2");
  });
});
