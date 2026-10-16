import { describe, expect, it } from "vite-plus/test";
import { getImportQueuePresentation } from "@/features/import/importQueuePresentation";
import type { PlaylistDownloadControllerSnapshot } from "@/features/import/playlistDownloadController";
import type { TagiumFile } from "@/features/library/types";
import { getSystemFailurePresentation } from "@/shared/systemFailure";

const failedTrack = (id: string, code: string): TagiumFile => ({
  id,
  status: "error",
  downloadStatus: "error",
  downloadError: getSystemFailurePresentation(new Error(code), "download").trackDescription,
  downloadRequest: {
    sourceUrl: `https://soundcloud.com/artist/${id}`,
    audioBitrate: "320",
    audioFormat: "mp3",
  },
  filename: `${id}.mp3`,
});

const snapshot = (files: TagiumFile[]): PlaylistDownloadControllerSnapshot => ({
  id: 1,
  trackIds: files.map((file) => file.id),
  total: files.length,
  completed: 0,
  failed: files.length,
  canceledCount: 0,
  pending: 0,
  active: [],
  startedAt: 0,
  canceled: false,
  done: true,
  waitingForTunnelBudget: false,
});

describe("import queue presentation", () => {
  it("offers retry when a failure could succeed on another attempt", () => {
    const files = [
      failedTrack("a", "error.api.soundcloud.maybe_drm"),
      failedTrack("b", "error.api.timed_out"),
    ];

    expect(getImportQueuePresentation(snapshot(files), files)?.canRetry).toBe(true);
  });

  it("hides retry when every failure is permanent", () => {
    const files = [
      failedTrack("a", "error.api.soundcloud.maybe_drm"),
      failedTrack("b", "error.api.content.post.unavailable"),
    ];

    expect(getImportQueuePresentation(snapshot(files), files)).toMatchObject({
      status: "error",
      failedCount: 2,
      canRetry: false,
    });
  });
});
