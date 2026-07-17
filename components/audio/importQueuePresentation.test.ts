import { describe, expect, it } from "vite-plus/test";
import { getImportQueuePresentation } from "./importQueuePresentation";
import type { PlaylistDownloadControllerSnapshot } from "./playlistDownloadController";
import type { TagiumFile } from "./types";

const snapshot = (
  overrides: Partial<PlaylistDownloadControllerSnapshot> = {},
): PlaylistDownloadControllerSnapshot => ({
  id: 1,
  trackIds: ["one", "two"],
  total: 2,
  completed: 0,
  failed: 0,
  canceledCount: 0,
  pending: 2,
  active: [],
  startedAt: 0,
  canceled: false,
  done: false,
  waitingForTunnelBudget: false,
  ...overrides,
});
const retryableFile = (id: string): TagiumFile => ({
  id,
  filename: `${id}.mp3`,
  status: "error",
  downloadStatus: "error",
  downloadRequest: { sourceUrl: `https://example.com/${id}`, audioBitrate: "320" },
});

describe("import queue presentation", () => {
  it("derives waiting, progress, eta, and retry capability from one snapshot", () => {
    expect(
      getImportQueuePresentation(
        snapshot({
          completed: 1,
          failed: 1,
          pending: 0,
          done: true,
          etaMs: 120_000,
        }),
        [retryableFile("two")],
      ),
    ).toMatchObject({
      status: "error",
      downloadedCount: 1,
      failedCount: 1,
      progress: 100,
      canCancel: false,
      canRetry: true,
      eta: "eta 2 min",
    });
  });

  it("keeps single-track controller state out of the playlist panel", () => {
    expect(getImportQueuePresentation(snapshot({ total: 1 }), [])).toBeNull();
  });
});
