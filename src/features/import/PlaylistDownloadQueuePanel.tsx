"use client";

import { useEffect, useState } from "react";
import { Num, T, useGT } from "gt-react";
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
  etaMs?: number;
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
  const gt = useGT();
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
            <p className="truncate text-xs font-medium">
              <QueueLabel queue={queue} />
            </p>
            {queue.etaMs !== undefined && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                <QueueEta etaMs={queue.etaMs} />
              </span>
            )}
          </div>
          {queue.status === "waiting" && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              <T>waiting to start more downloads...</T>
            </p>
          )}
          {queue.status === "canceled" && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              <T>remaining tracks canceled</T>
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
        aria-label={gt("playlist download progress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
      </div>

      {queue.status === "error" && (
        <p className="mt-2 text-[11px] text-destructive">
          <FailureSummary failedCount={queue.failedCount} />
        </p>
      )}
    </section>
  );
}

function FailureSummary({ failedCount }: { failedCount: number }) {
  const gt = useGT();

  return gt(
    "{count, plural, one {# track couldn't be saved. select it to see why.} other {# tracks couldn't be saved. select one to see why.}}",
    { count: failedCount },
  );
}

function QueueLabel({ queue }: { queue: PlaylistDownloadQueuePanelState }) {
  switch (queue.status) {
    case "error":
      return (
        <T>
          failed <Num>{queue.failedCount}</Num>/<Num>{queue.totalCount}</Num>
        </T>
      );
    case "canceled":
      return (
        <T>
          canceled <Num>{queue.canceledCount}</Num>/<Num>{queue.totalCount}</Num>
        </T>
      );
    case "complete":
      return (
        <T>
          downloaded <Num>{queue.downloadedCount}</Num>/<Num>{queue.totalCount}</Num>
        </T>
      );
    default:
      return (
        <T>
          downloading <Num>{queue.downloadedCount}</Num>/<Num>{queue.totalCount}</Num>
        </T>
      );
  }
}

function QueueEta({ etaMs }: { etaMs: number }) {
  const minutes = Math.ceil(etaMs / 60_000);

  if (minutes <= 1) return <T>eta &lt;1 min</T>;

  if (minutes < 60) {
    return (
      <T>
        eta <Num>{minutes}</Num> min
      </T>
    );
  }

  const hours = Math.floor(minutes / 60);
  const leftoverMinutes = minutes % 60;

  if (leftoverMinutes === 0) {
    return (
      <T>
        eta <Num>{hours}</Num> hr
      </T>
    );
  }

  return (
    <T>
      eta <Num>{hours}</Num> hr <Num>{leftoverMinutes}</Num> min
    </T>
  );
}

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
  const gt = useGT();
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
          aria-label={gt("retry playlist downloads")}
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
          aria-label={gt("cancel playlist downloads")}
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
          aria-label={gt("dismiss playlist download progress")}
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
        <p className="text-[11px] text-muted-foreground">
          <T>
            +<Num>{hiddenTrackCount}</Num> more
          </T>
        </p>
      )}
    </div>
  );
}
