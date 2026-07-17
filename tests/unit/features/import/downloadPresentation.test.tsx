import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SortableTrackRow } from "@/features/library/AlbumSidebarDnd";
import PlaylistDownloadQueuePanel from "@/features/import/PlaylistDownloadQueuePanel";
import type { TagiumFile } from "@/features/library/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("download presentation", () => {
  it("describes admission waits without exposing Cobalt implementation details", () => {
    const markup = renderToStaticMarkup(
      <PlaylistDownloadQueuePanel
        queue={{
          id: 1,
          status: "waiting",
          downloadedCount: 20,
          totalCount: 21,
          failedCount: 0,
          canceledCount: 0,
          currentTracks: [],
          progress: 95,
        }}
      />,
    );

    expect(markup).toContain("waiting to start more downloads...");
    expect(markup.toLowerCase()).not.toContain("cobalt");
    expect(markup).not.toContain("tunnel budget");
  });

  it("keeps canceled track rows compact without a repeated status line", () => {
    const track = {
      id: "track-1",
      filename: "Summer Fling.mp3",
      status: "pending",
      downloadStatus: "canceled",
    } as TagiumFile;
    const markup = renderToStaticMarkup(
      <SortableTrackRow
        track={track}
        index={15}
        container="album"
        albumId="album-1"
        selectedTone={null}
        muted={false}
        retryable
        onSelect={() => {}}
        onRemove={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(markup).not.toContain(">canceled<");
    expect(markup).toContain("h-3 w-3 text-muted-foreground flex-shrink-0 group-hover:opacity-0");
  });

  it("lets a completed queue be dismissed and hides it automatically after ten seconds", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        <PlaylistDownloadQueuePanel
          queue={{
            id: 2,
            status: "complete",
            downloadedCount: 13,
            totalCount: 13,
            failedCount: 0,
            canceledCount: 0,
            currentTracks: [],
            progress: 100,
          }}
        />,
      );
    });

    expect(renderer!.toJSON()).not.toBeNull();
    expect(
      renderer!.root.findByProps({ "aria-label": "dismiss playlist download progress" }),
    ).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(9_999);
    });
    expect(renderer!.toJSON()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(renderer!.toJSON()).toBeNull();
    act(() => renderer!.unmount());
  });
});
