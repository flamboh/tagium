"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { Cancel01Icon, Refresh04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { fadePresence, rowContent, rowShell } from "@/lib/motion";

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

  const visible = Boolean(queue) && dismissedQueueId !== queue?.id;
  const progress = queue ? Math.min(100, Math.max(0, queue.progress)) : 0;
  const shownTracks = queue?.currentTracks.slice(0, 2) ?? [];
  const hiddenTrackCount = (queue?.currentTracks.length ?? 0) - shownTracks.length;
  const showCancel = Boolean(onCancel && queue?.canCancel !== false);
  const showRetry = Boolean(onRetry && queue?.canRetry !== false);
  let label = queue ? `downloading ${queue.downloadedCount}/${queue.totalCount}` : "";
  if (queue?.status === "error") label = `failed ${queue.failedCount}/${queue.totalCount}`;
  if (queue?.status === "canceled") label = `canceled ${queue.canceledCount}/${queue.totalCount}`;
  if (queue?.status === "complete")
    label = `downloaded ${queue.downloadedCount}/${queue.totalCount}`;

  return (
    <AnimatePresence initial={false}>
      {visible && queue && (
        <m.section
          key={queue.id}
          {...rowShell}
          className="shrink-0 border-t bg-muted/20"
          aria-live="polite"
        >
          <m.div {...rowContent} className="px-3 py-3">
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
                <AnimatePresence initial={false}>
                  {shownTracks.map((track) => (
                    <m.p
                      key={track.id}
                      {...fadePresence}
                      className="truncate text-xs text-muted-foreground"
                    >
                      {track.title}
                    </m.p>
                  ))}
                </AnimatePresence>
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
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>

            <AnimatePresence initial={false}>
              {queue.status === "error" && (
                <m.p key="error" {...fadePresence} className="mt-2 text-[11px] text-destructive">
                  downloads failed
                </m.p>
              )}
            </AnimatePresence>
          </m.div>
        </m.section>
      )}
    </AnimatePresence>
  );
}
