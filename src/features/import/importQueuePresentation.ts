import type { PlaylistDownloadControllerSnapshot } from "@/features/import/playlistDownloadController";
import type { PlaylistDownloadQueuePanelState } from "@/features/import/PlaylistDownloadQueuePanel";
import type { TagiumFile } from "@/features/library/types";
import { getTrackFailureDisplay } from "@/shared/systemFailure";

export const getImportQueuePresentation = (
  snapshot: PlaylistDownloadControllerSnapshot | null,
  files: TagiumFile[],
): PlaylistDownloadQueuePanelState | null => {
  if (!snapshot || snapshot.total <= 1) return null;
  const trackIds = new Set(snapshot.trackIds);

  const retryCount = files.filter(
    (file) =>
      trackIds.has(file.id) &&
      !file.file &&
      file.downloadRequest &&
      (!file.downloadError || getTrackFailureDisplay(file.downloadError).retryable),
  ).length;

  let status: PlaylistDownloadQueuePanelState["status"] = "downloading";

  if (snapshot.waitingForTunnelBudget) status = "waiting";

  if (snapshot.done && snapshot.failed === 0 && !snapshot.canceled) status = "complete";

  if (snapshot.done && snapshot.failed > 0) status = "error";

  if (snapshot.canceled && snapshot.failed === 0) status = "canceled";
  const settled = snapshot.completed + snapshot.failed + snapshot.canceledCount;

  const presentation: PlaylistDownloadQueuePanelState = {
    id: snapshot.id,
    status,
    downloadedCount: snapshot.completed,
    totalCount: snapshot.total,
    failedCount: snapshot.failed,
    canceledCount: snapshot.canceledCount,
    currentTracks: snapshot.active.map((track) => ({ id: track.fileId, title: track.title })),
    progress: (settled / snapshot.total) * 100,
    canCancel: !snapshot.done && !snapshot.canceled,
    canRetry: Boolean(
      snapshot.active.length === 0 && retryCount > 0 && (snapshot.canceled || snapshot.failed > 0),
    ),
  };

  if (snapshot.etaMs !== undefined) presentation.etaMs = snapshot.etaMs;

  return presentation;
};
