"use client";

import { useEffect, useState } from "react";
import { Cancel01Icon, Refresh04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";

export type PlaylistDownloadQueueStatus =
  | "downloading"
  | "waiting"
  | "complete"
  | "error"
  | "canceled";

export interface PlaylistDownloadQueueTrack {
  id: string;
  title: string;
}

export interface PlaylistDownloadQueuePanelState {
  id: number;
  status: PlaylistDownloadQueueStatus;
  downloadedCount: number;
  totalCount: number;
  failedCount: number;
  canceledCount: number;
  currentTracks: PlaylistDownloadQueueTrack[];
  progress: number;
  eta?: string;
  canCancel?: boolean;
  canRetry?: boolean;
}

interface PlaylistDownloadQueuePanelProps {
  queue: PlaylistDownloadQueuePanelState | null;
  onCancel?: () => void;
  onRetry?: () => void;
}

export default function PlaylistDownloadQueuePanel({
  queue,
  onCancel,
  onRetry,
}: PlaylistDownloadQueuePanelProps) {
  const [dismissedQueueId, setDismissedQueueId] = useState<number | null>(null);

  useEffect(() => {
    if (!queue || queue.status !== "complete") return;

    const timeout = window.setTimeout(() => setDismissedQueueId(queue.id), 10_000);

    return () => window.clearTimeout(timeout);
  }, [queue]);

  if (!queue || dismissedQueueId === queue.id) return null;

  const progress = Math.min(100, Math.max(0, queue.progress));

  return (
    <section className="shrink-0 border-t bg-muted/20 px-3 py-3" aria-live="polite">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-xs font-medium">{queueLabel(queue)}</p>
            {queue.eta && (
              <span className="shrink-0 text-[11px] text-muted-foreground">{queue.eta}</span>
            )}
          </div>
          {queue.status === "waiting" && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              waiting to start more downloads...
            </p>
          )}
          {queue.status === "canceled" && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              remaining tracks canceled
            </p>
          )}
        </div>

        <PlaylistQueueActions
          queue={queue}
          onCancel={onCancel}
          onRetry={onRetry}
          onDismiss={() => setDismissedQueueId(queue.id)}
        />
      </div>

      <PlaylistQueueTracks tracks={queue.currentTracks} />

      <div
        className="mt-2 h-1.5 overflow-hidden rounded-lg bg-background"
        role="progressbar"
        aria-label="playlist download progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
      </div>

      {queue.status === "error" && (
        <p className="mt-2 text-[11px] text-destructive">downloads failed</p>
      )}
    </section>
  );
}

const queueLabel = (queue: PlaylistDownloadQueuePanelState) => {
  switch (queue.status) {
    case "error":
      return `failed ${queue.failedCount}/${queue.totalCount}`;
    case "canceled":
      return `canceled ${queue.canceledCount}/${queue.totalCount}`;
    case "complete":
      return `downloaded ${queue.downloadedCount}/${queue.totalCount}`;
    default:
      return `downloading ${queue.downloadedCount}/${queue.totalCount}`;
  }
};

function PlaylistQueueActions({
  queue,
  onCancel,
  onRetry,
  onDismiss,
}: {
  queue: PlaylistDownloadQueuePanelState;
  onCancel?: () => void;
  onRetry?: () => void;
  onDismiss: () => void;
}) {
  const showCancel = Boolean(onCancel && queue.canCancel !== false);
  const showRetry = Boolean(onRetry && queue.canRetry !== false);

  if (!showCancel && !showRetry && queue.status === "downloading") return null;

  return (
    <div className="flex shrink-0 items-center gap-1">
      {showRetry && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onRetry}
          aria-label="retry playlist downloads"
        >
          <HugeiconsIcon icon={Refresh04Icon} strokeWidth={2} className="size-3.5" />
        </Button>
      )}
      {showCancel ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onCancel}
          aria-label="cancel playlist downloads"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onDismiss}
          aria-label="dismiss playlist download progress"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

function PlaylistQueueTracks({ tracks }: { tracks: PlaylistDownloadQueueTrack[] }) {
  if (tracks.length === 0) return null;

  const shownTracks = tracks.slice(0, 2);
  const hiddenTrackCount = tracks.length - shownTracks.length;

  return (
    <div className="mt-2 space-y-1">
      {shownTracks.map((track) => (
        <p key={track.id} className="truncate text-xs text-muted-foreground">
          {track.title}
        </p>
      ))}
      {hiddenTrackCount > 0 && (
        <p className="text-[11px] text-muted-foreground">+{hiddenTrackCount} more</p>
      )}
    </div>
  );
}
