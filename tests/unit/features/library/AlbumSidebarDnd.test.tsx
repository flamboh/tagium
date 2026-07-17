import type { ReactNode } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setActivatorNodeRef: vi.fn(),
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

import { SortableAlbumCard } from "@/features/library/AlbumSidebarDnd";

describe("album cleanup action", () => {
  it("offers an accessible apply-edits action only when suggestions exist", () => {
    const onReviewCleanup = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <SortableAlbumCard
          album={{
            id: "album",
            title: "Untrue",
            artist: "Burial",
            genre: "Electronic",
            trackIds: ["track"],
          }}
          selected={false}
          canDownload={false}
          hasCleanupSuggestions
          onSelect={vi.fn()}
          onEdit={vi.fn()}
          onDownload={vi.fn()}
          onReviewCleanup={onReviewCleanup}
          onFileDragOver={vi.fn()}
          onFileDrop={vi.fn()}
        >
          <div />
        </SortableAlbumCard>,
      );
    });

    const action = renderer!.root.findByProps({
      "aria-label": "apply suggested edits to Untrue",
    });
    expect(
      renderer!.root.findAllByType("span").some((node) => node.children.includes("apply edits?")),
    ).toBe(true);
    void act(() => action.props.onClick());
    expect(onReviewCleanup).toHaveBeenCalledOnce();
    act(() => renderer!.unmount());
  });
});
