import type { PlaylistDownloadControllerSnapshot } from "./playlistDownloadController";
import type { PlaylistDownloadQueuePanelState } from "./PlaylistDownloadQueuePanel";
import type { TagiumFile } from "./types";

const formatEta = (etaMs?: number) => {
  if (etaMs === undefined) return null;
  const minutes = Math.ceil(etaMs / 60_000);
  if (minutes <= 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const leftoverMinutes = minutes % 60;
  return leftoverMinutes === 0 ? `${hours} hr` : `${hours} hr ${leftoverMinutes} min`;
};

export const getImportQueuePresentation = (
  snapshot: PlaylistDownloadControllerSnapshot | null,
  files: TagiumFile[],
): PlaylistDownloadQueuePanelState | null => {
  if (!snapshot || snapshot.total <= 1) return null;
  const trackIds = new Set(snapshot.trackIds);
  const retryCount = files.filter(
    (file) => trackIds.has(file.id) && !file.file && file.downloadRequest,
  ).length;
  let status: PlaylistDownloadQueuePanelState["status"] = "downloading";
  if (snapshot.waitingForTunnelBudget) status = "waiting";
  if (snapshot.done && snapshot.failed > 0) status = "error";
  if (snapshot.canceled && snapshot.failed === 0) status = "canceled";
  const settled = snapshot.completed + snapshot.failed + snapshot.canceledCount;
  const eta = formatEta(snapshot.etaMs);
  return {
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
    ...(eta ? { eta: `eta ${eta}` } : {}),
  };
};
