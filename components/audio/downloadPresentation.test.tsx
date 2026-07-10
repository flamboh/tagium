import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { SortableTrackRow } from "./AlbumSidebarDnd";
import PlaylistDownloadQueuePanel from "./PlaylistDownloadQueuePanel";
import type { TagiumFile } from "./types";

describe("download presentation", () => {
  it("describes admission waits without exposing Cobalt implementation details", () => {
    const markup = renderToStaticMarkup(
      <PlaylistDownloadQueuePanel
        queue={{
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
    expect(markup).not.toContain("Cobalt");
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
  });
});
