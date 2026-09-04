"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Cancel01Icon, Refresh04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { animateRowEnter } from "@/lib/motion";

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
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const queueId = queue?.id;

  useEffect(() => {
    if (!queue || queue.status !== "complete") return;

    const timeout = window.setTimeout(() => setDismissedQueueId(queue.id), 10_000);
    return () => window.clearTimeout(timeout);
  }, [queue]);

  useLayoutEffect(() => {
    if (queueId === undefined || !sectionRef.current) return;
    return animateRowEnter(sectionRef.current, contentRef.current);
  }, [queueId]);

  if (!queue || dismissedQueueId === queue.id) return null;

  const progress = Math.min(100, Math.max(0, queue.progress));
  const shownTracks = queue.currentTracks.slice(0, 2);
  const hiddenTrackCount = queue.currentTracks.length - shownTracks.length;
  const showCancel = Boolean(onCancel && queue.canCancel !== false);
  const showRetry = Boolean(onRetry && queue.canRetry !== false);
  let label = `downloading ${queue.downloadedCount}/${queue.totalCount}`;
  if (queue.status === "error") {
    label = `failed ${queue.failedCount}/${queue.totalCount}`;
  }
  if (queue.status === "canceled") {
    label = `canceled ${queue.canceledCount}/${queue.totalCount}`;
  }
  if (queue.status === "complete") {
    label = `downloaded ${queue.downloadedCount}/${queue.totalCount}`;
  }

  return (
    <section
      ref={sectionRef}
      className="shrink-0 overflow-hidden border-t bg-muted/20 px-3 py-3"
      aria-live="polite"
    >
      <div ref={contentRef}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-xs font-medium">{label}</p>
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

          {(showCancel || showRetry || queue.status !== "downloading") && (
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
              {showCancel && (
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
              )}
              {!showCancel && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setDismissedQueueId(queue.id)}
                  aria-label="dismiss playlist download progress"
                >
                  <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>

        {shownTracks.length > 0 && (
          <div className="mt-2 space-y-1">
            {shownTracks.map((track) => (
              <p
                key={track.id}
                className="truncate text-xs text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
              >
                {track.title}
              </p>
            ))}
            {hiddenTrackCount > 0 && (
              <p className="text-[11px] text-muted-foreground">+{hiddenTrackCount} more</p>
            )}
          </div>
        )}

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
          <p className="mt-2 text-[11px] text-destructive motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
            downloads failed
          </p>
        )}
      </div>
    </section>
  );
}
