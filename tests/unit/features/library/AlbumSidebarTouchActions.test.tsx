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

import { SortableTrackRow } from "@/features/library/AlbumSidebarDnd";

describe("track row touch actions", () => {
  it("keeps remove and retry visible with coarse pointers and normally clickable", () => {
    const onRemove = vi.fn();
    const onRetry = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <SortableTrackRow
          track={{
            id: "track",
            format: "mp3",
            filename: "touch-track.mp3",
            status: "error",
            downloadStatus: "error",
            downloadRequest: { sourceUrl: "https://example.com/track", audioBitrate: "320" },
          }}
          container="loose"
          selectedTone={null}
          muted={false}
          retryable
          onSelect={vi.fn()}
          onRemove={onRemove}
          onRetry={onRetry}
        />,
      );
    });

    const remove = renderer!.root.findByProps({ "aria-label": "remove track" });
    const retry = renderer!.root.findByProps({
      "aria-label": "retry download for touch-track.mp3",
    });
    expect(remove.props.className).toContain("[@media(pointer:coarse)]:opacity-100");
    expect(retry.props.className).toContain("[@media(pointer:coarse)]:opacity-100");
    void act(() => remove.props.onClick({ stopPropagation: vi.fn() }));
    void act(() => retry.props.onClick({ stopPropagation: vi.fn() }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
    act(() => renderer!.unmount());
  });
});
