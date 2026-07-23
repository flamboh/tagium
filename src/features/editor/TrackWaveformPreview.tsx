"use client";

import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
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

interface PreviewState {
  waveform: WaveformPreviewData | null;
  waveformStatus: WaveformStatus;
  playbackUnavailable: boolean;
  playing: boolean;
  currentTime: number;
  mediaDuration: { fileId: string; duration: number } | null;
}

type PreviewAction =
  | { type: "reset"; file?: File }
  | { type: "playing"; value: boolean }
  | { type: "currentTime"; value: number }
  | { type: "mediaDuration"; value: PreviewState["mediaDuration"] }
  | { type: "playbackUnavailable"; value: boolean }
  | { type: "waveform"; value: WaveformPreviewData | null }
  | { type: "waveformStatus"; value: WaveformStatus };

const previewReducer = (state: PreviewState, action: PreviewAction): PreviewState => {
  switch (action.type) {
    case "reset":
      return { waveform: null, waveformStatus: action.file ? "loading" : "idle", playbackUnavailable: false, playing: false, currentTime: 0, mediaDuration: null };
    case "playing": return { ...state, playing: action.value };
    case "currentTime": return { ...state, currentTime: action.value };
    case "mediaDuration": return { ...state, mediaDuration: action.value };
    case "playbackUnavailable": return { ...state, playbackUnavailable: action.value };
    case "waveform": return { ...state, waveform: action.value };
    case "waveformStatus": return { ...state, waveformStatus: action.value };
  }
};

const initialPreviewState: PreviewState = { waveform: null, waveformStatus: "idle", playbackUnavailable: false, playing: false, currentTime: 0, mediaDuration: null };

const getWaveformWidth = (duration: number) =>
  Math.min(4_800, Math.max(640, Math.round(duration * 6)));

const getStatusMessage = ({
  file,
  playbackUnavailable,
  waveformStatus,
}: Pick<TrackWaveformPreviewProps, "file"> & Pick<PreviewState, "playbackUnavailable" | "waveformStatus">) =>
  !file
    ? "preview is available after this track finishes downloading"
    : playbackUnavailable
      ? "this audio format cannot be previewed here"
      : waveformStatus === "loading"
        ? "building waveform"
        : waveformStatus === "unavailable"
          ? "waveform unavailable — playback may still work"
          : null;

export default function TrackWaveformPreview({
  active,
  file,
  fileId,
  fallbackDuration,
  title,
}: TrackWaveformPreviewProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const sourceGenerationRef = useRef(0);
  const mediaGenerationRef = useRef<number | null>(null);
  const dragRef = useRef({ active: false, startX: 0, moved: false });
  const [state, dispatch] = useReducer(previewReducer, initialPreviewState);
  const { waveform, waveformStatus, playbackUnavailable, playing, currentTime, mediaDuration } = state;
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

  useLayoutEffect(() => {
    if (active) return;
    const audio = audioRef.current;
    audio?.pause();
    if (audio) audio.currentTime = 0;
    dispatch({ type: "playing", value: false });
    dispatch({ type: "currentTime", value: 0 });
  }, [active]);

  useLayoutEffect(() => {
    sourceGenerationRef.current += 1;
    const audio = audioRef.current;
    audio?.pause();
    if (audio) audio.currentTime = 0;
    dispatch({ type: "reset", file });
  }, [file, fileId]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!file || !audio) {
      return;
    }

    // react-doctor-disable-next-line no-create-object-url-without-revoke -- the cleanup below revokes this exact URL before the source is replaced or unmounted.
    const objectUrl = URL.createObjectURL(file);
    const generation = sourceGenerationRef.current;
    mediaGenerationRef.current = generation;
    audio.currentTime = 0;
    audio.src = objectUrl;
    audio.load();
    return () => {
      if (mediaGenerationRef.current === generation) mediaGenerationRef.current = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, fileId]);

  useEffect(() => {
    if (!file) return;
    const generation = sourceGenerationRef.current;
    if (decodeDuration === 0) {
      const timeoutId = globalThis.setTimeout(() => {
        if (sourceGenerationRef.current === generation) dispatch({ type: "waveformStatus", value: "unavailable" });
      }, METADATA_WAIT_TIMEOUT_MS);
      return () => globalThis.clearTimeout(timeoutId);
    }

    const controller = new AbortController();
    dispatch({ type: "waveformStatus", value: "loading" });
    void loadWaveformPreview(file, controller.signal, decodeDuration).then(
      (preview) => {
        if (controller.signal.aborted || sourceGenerationRef.current !== generation) return;
        dispatch({ type: "waveform", value: preview });
        dispatch({ type: "waveformStatus", value: "ready" });
      },
      (error: unknown) => {
        if (
          sourceGenerationRef.current !== generation ||
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        dispatch({ type: "waveformStatus", value: "unavailable" });
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
      dispatch({ type: "currentTime", value: nextTime });
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
      dispatch({ type: "playbackUnavailable", value: true });
      dispatch({ type: "playing", value: false });
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

  const statusMessage = getStatusMessage({ file, playbackUnavailable, waveformStatus });

  return (
    <section
      className="flex min-h-32 flex-1 flex-col justify-end gap-2 pt-1"
      aria-label={`preview ${title || file?.name || "selected track"}`}
      data-waveform-status={waveformStatus}
    >
      {/* react-doctor-disable-next-line media-has-caption -- previews play user-provided music files, and Tagium has no truthful timed-text cue data to attach. */}
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={(event) =>
          mediaGenerationRef.current === sourceGenerationRef.current &&
          dispatch({ type: "mediaDuration", value: {
            fileId,
            duration: normalizePreviewDuration(event.currentTarget.duration),
          } })
        }
        onDurationChange={(event) =>
          mediaGenerationRef.current === sourceGenerationRef.current &&
          dispatch({ type: "mediaDuration", value: {
            fileId,
            duration: normalizePreviewDuration(event.currentTarget.duration),
          } })
        }
        onTimeUpdate={(event) => {
          if (mediaGenerationRef.current !== sourceGenerationRef.current) return;
          dispatch({ type: "currentTime", value: normalizePreviewDuration(event.currentTarget.currentTime) });
        }}
        onPlay={() => {
          if (mediaGenerationRef.current === sourceGenerationRef.current) dispatch({ type: "playing", value: true });
        }}
        onPause={() => {
          if (mediaGenerationRef.current === sourceGenerationRef.current) dispatch({ type: "playing", value: false });
        }}
        onEnded={(event) => {
          if (mediaGenerationRef.current !== sourceGenerationRef.current) return;
          event.currentTarget.currentTime = 0;
          dispatch({ type: "playing", value: false });
          dispatch({ type: "currentTime", value: 0 });
        }}
        onError={() => {
          if (mediaGenerationRef.current !== sourceGenerationRef.current) return;
          dispatch({ type: "playbackUnavailable", value: true });
          if (decodeDuration === 0) dispatch({ type: "waveformStatus", value: "unavailable" });
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
