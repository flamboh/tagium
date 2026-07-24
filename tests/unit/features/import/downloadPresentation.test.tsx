import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Check } from "lucide-react";
import { SortableTrackRow } from "@/features/library/AlbumSidebarDnd";
import PlaylistDownloadQueuePanel from "@/features/import/PlaylistDownloadQueuePanel";
import type { TagiumFile } from "@/features/library/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("download presentation", () => {
  const renderTrackRow = (track: TagiumFile) => (
    <SortableTrackRow
      track={track}
      index={1}
      container="album"
      albumId="album-1"
      selectedTone={null}
      muted={false}
      retryable={false}
      onSelect={() => {}}
      onRemove={() => {}}
      onRetry={() => {}}
    />
  );

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

  it("shows saved feedback for three seconds after a status transition and cleans timers up", () => {
    vi.useFakeTimers();
    const pendingTrack = {
      id: "track-saved-feedback",
      filename: "Saved Track.mp3",
      status: "pending",
      downloadStatus: "ready",
    } as TagiumFile;
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(renderTrackRow(pendingTrack));
    });
    expect(renderer!.root.findAllByType(Check)).toHaveLength(0);

    act(() => {
      renderer!.update(renderTrackRow({ ...pendingTrack, status: "saved" }));
    });
    expect(renderer!.root.findAllByType(Check)).toHaveLength(1);
    expect(renderer!.root.findAllByProps({ role: "status", "aria-live": "polite" })).toHaveLength(
      1,
    );
    expect(renderer!.root.findByType(Check).props["aria-hidden"]).toBe("true");

    act(() => {
      vi.advanceTimersByTime(2_999);
    });
    expect(renderer!.root.findAllByType(Check)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(renderer!.root.findAllByType(Check)).toHaveLength(0);

    act(() => {
      renderer!.update(renderTrackRow({ ...pendingTrack, status: "pending" }));
    });
    act(() => {
      renderer!.update(renderTrackRow({ ...pendingTrack, status: "saved" }));
    });
    expect(vi.getTimerCount()).toBe(1);
    act(() => renderer!.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not announce an initially saved track", () => {
    vi.useFakeTimers();
    const savedTrack = {
      id: "already-saved-track",
      filename: "Already Saved.mp3",
      status: "saved",
      downloadStatus: "ready",
    } as TagiumFile;
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(renderTrackRow(savedTrack));
    });

    expect(renderer!.root.findAllByType(Check)).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ role: "status" })).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => renderer!.unmount());
  });
});
