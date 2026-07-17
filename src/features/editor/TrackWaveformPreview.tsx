"use client";

import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  formatPreviewTime,
  getSeekTime,
  loadWaveformPreview,
  normalizePreviewDuration,
  type WaveformPreviewData,
} from "@/features/editor/waveformPreview";

interface TrackWaveformPreviewProps {
  active: boolean;
  file?: File;
  fileId: string;
  fallbackDuration: number;
  title: string;
}

type WaveformStatus = "idle" | "loading" | "ready" | "unavailable";
const METADATA_WAIT_TIMEOUT_MS = 5_000;

const getWaveformWidth = (duration: number) =>
  Math.min(4_800, Math.max(640, Math.round(duration * 6)));

export default function TrackWaveformPreview({
  active,
  file,
  fileId,
  fallbackDuration,
  title,
}: TrackWaveformPreviewProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const dragRef = useRef({ active: false, startX: 0, moved: false });
  const [waveform, setWaveform] = useState<WaveformPreviewData | null>(null);
  const [waveformStatus, setWaveformStatus] = useState<WaveformStatus>("idle");
  const [playbackUnavailable, setPlaybackUnavailable] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<{ fileId: string; duration: number } | null>(
    null,
  );
  const currentMediaDuration = mediaDuration?.fileId === fileId ? mediaDuration.duration : 0;
  const duration =
    normalizePreviewDuration(currentMediaDuration) ||
    normalizePreviewDuration(waveform?.duration) ||
    normalizePreviewDuration(fallbackDuration);
  const normalizedCurrentTime = Math.min(duration, normalizePreviewDuration(currentTime));
  const progress = duration > 0 ? Math.min(1, normalizedCurrentTime / duration) : 0;
  const waveformWidth = getWaveformWidth(duration);
  const canPlay = active && Boolean(file) && !playbackUnavailable;
  const canSeek = canPlay && duration > 0;
  const decodeDuration =
    normalizePreviewDuration(fallbackDuration) || normalizePreviewDuration(currentMediaDuration);

  useEffect(() => {
    if (active) return;
    const audio = audioRef.current;
    audio?.pause();
    setPlaying(false);
  }, [active]);

  useEffect(() => {
    const audio = audioRef.current;
    setPlaying(false);
    setCurrentTime(0);
    setMediaDuration(null);
    setPlaybackUnavailable(false);
    setWaveform(null);
    setWaveformStatus(file ? "loading" : "idle");

    if (!file || !audio) {
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    audio.currentTime = 0;
    audio.src = objectUrl;
    audio.load();
    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, fileId]);

  useEffect(() => {
    if (!file) return;
    if (decodeDuration === 0) {
      const timeoutId = globalThis.setTimeout(
        () => setWaveformStatus("unavailable"),
        METADATA_WAIT_TIMEOUT_MS,
      );
      return () => globalThis.clearTimeout(timeoutId);
    }

    const controller = new AbortController();
    setWaveformStatus("loading");
    void loadWaveformPreview(file, controller.signal, decodeDuration).then(
      (preview) => {
        if (controller.signal.aborted) return;
        setWaveform(preview);
        setWaveformStatus("ready");
      },
      (error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        setWaveformStatus("unavailable");
      },
    );

    return () => {
      controller.abort();
    };
  }, [decodeDuration, file, fileId]);

  const seekTo = useCallback(
    (time: number) => {
      const audio = audioRef.current;
      if (!audio || !canSeek) return;
      const nextTime = Math.min(duration, Math.max(0, time));
      audio.currentTime = nextTime;
      setCurrentTime(nextTime);
    },
    [canSeek, duration],
  );

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!canSeek) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    seekTo(getSeekTime(event.clientX, bounds.left, bounds.width, duration));
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !canPlay) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      setPlaybackUnavailable(true);
      setPlaying(false);
    }
  };

  const handleWaveformKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canPlay) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (!canSeek) return;
      event.preventDefault();
      seekTo(currentTime + (event.key === "ArrowLeft" ? -5 : 5));
    } else if (event.key === "Home" || event.key === "End") {
      if (!canSeek) return;
      event.preventDefault();
      seekTo(event.key === "Home" ? 0 : duration);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      void togglePlayback();
    }
  };

  const statusMessage = !file
    ? "preview is available after this track finishes downloading"
    : playbackUnavailable
      ? "this audio format cannot be previewed here"
      : waveformStatus === "loading"
        ? "building waveform"
        : waveformStatus === "unavailable"
          ? "waveform unavailable — playback may still work"
          : null;

  return (
    <section
      className="flex min-h-32 flex-1 flex-col justify-end gap-2 pt-1"
      aria-label={`preview ${title || file?.name || "selected track"}`}
      data-waveform-status={waveformStatus}
    >
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={(event) =>
          setMediaDuration({
            fileId,
            duration: normalizePreviewDuration(event.currentTarget.duration),
          })
        }
        onDurationChange={(event) =>
          setMediaDuration({
            fileId,
            duration: normalizePreviewDuration(event.currentTarget.duration),
          })
        }
        onTimeUpdate={(event) =>
          setCurrentTime(normalizePreviewDuration(event.currentTarget.currentTime))
        }
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(event) => {
          event.currentTarget.currentTime = 0;
          setPlaying(false);
          setCurrentTime(0);
        }}
        onError={() => {
          setPlaybackUnavailable(true);
          if (decodeDuration === 0) setWaveformStatus("unavailable");
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10"
          onClick={() => void togglePlayback()}
          disabled={!canPlay}
          aria-label={playing ? "pause preview" : "play preview"}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-3 font-mono text-[11px] tabular-nums text-muted-foreground">
            <span>{formatPreviewTime(normalizedCurrentTime)}</span>
            <span>{formatPreviewTime(duration)}</span>
          </div>
          <div
            className="overflow-x-auto overscroll-x-contain rounded-md border bg-muted/15 focus-within:ring-2 focus-within:ring-ring/50"
            data-waveform-scroller
          >
            <div
              role="slider"
              tabIndex={canSeek ? 0 : -1}
              aria-label="track position"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, Math.round(duration))}
              aria-valuenow={Math.round(normalizedCurrentTime)}
              aria-valuetext={`${formatPreviewTime(normalizedCurrentTime)} of ${formatPreviewTime(duration)}`}
              aria-disabled={!canSeek}
              onKeyDown={handleWaveformKeyDown}
              onPointerDown={(event) => {
                if (!canSeek) return;
                dragRef.current = { active: true, startX: event.clientX, moved: false };
                if (event.pointerType === "mouse") {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  seekFromPointer(event);
                }
              }}
              onPointerMove={(event) => {
                if (!dragRef.current.active) return;
                if (Math.abs(event.clientX - dragRef.current.startX) > 8) {
                  dragRef.current.moved = true;
                }
                if (event.pointerType === "mouse") seekFromPointer(event);
              }}
              onPointerUp={(event) => {
                if (event.pointerType !== "mouse" && !dragRef.current.moved) seekFromPointer(event);
                dragRef.current.active = false;
              }}
              onPointerCancel={() => {
                dragRef.current.active = false;
              }}
              className={`relative h-20 touch-pan-x select-none overflow-hidden outline-none motion-reduce:scroll-auto ${
                canSeek ? "cursor-pointer" : "cursor-not-allowed"
              }`}
              style={{ width: waveformWidth }}
            >
              {waveform ? (
                <>
                  <WaveformBars samples={waveform.samples} className="fill-muted-foreground/35" />
                  <div
                    className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden"
                    style={{ width: `${progress * 100}%` }}
                    aria-hidden
                  >
                    <WaveformBars
                      samples={waveform.samples}
                      className="fill-primary"
                      width={waveformWidth}
                    />
                  </div>
                  <span
                    className="pointer-events-none absolute inset-y-1 w-px bg-primary motion-reduce:transition-none"
                    style={{ left: `${progress * 100}%` }}
                    aria-hidden
                  />
                </>
              ) : (
                <div
                  className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground"
                  role="status"
                >
                  {statusMessage ?? "waveform preview"}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {statusMessage && waveform && (
        <p className="text-xs text-muted-foreground" role="status">
          {statusMessage}
        </p>
      )}
    </section>
  );
}

function WaveformBars({
  samples,
  className,
  width = "100%",
}: {
  samples: number[];
  className: string;
  width?: number | string;
}) {
  return (
    <svg
      className={`pointer-events-none absolute inset-0 h-full ${className}`}
      width={width}
      height="100%"
      viewBox={`0 0 ${samples.length * 3} 80`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {samples.map((sample, index) => {
        const height = Math.max(2, sample * 68);
        return (
          <rect key={index} x={index * 3} y={(80 - height) / 2} width={2} height={height} rx={1} />
        );
      })}
    </svg>
  );
}
