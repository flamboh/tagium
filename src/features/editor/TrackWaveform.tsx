import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { IconSwap } from "@/components/ui/icon-swap";
import {
  formatTimestamp,
  fullClip,
  getPointerTime,
  loadWaveform,
  moveClipEdge,
  normalizeClip,
  normalizeSeconds,
  resamplePeaks,
  type WaveformData,
} from "@/features/editor/waveform";
import type { TrackClip } from "@/features/library/types";
import { cn } from "@/lib/utils";

const WAVEFORM_HEIGHT = 44;

const BAR_WIDTH = 2;

const BAR_GAP = 1;

// Stands in for the real peaks while the track downloads or decodes.
const PLACEHOLDER_PEAKS = Array.from({ length: 256 }, (_, index) => {
  const swell = 0.45 + 0.3 * Math.sin(index / 9) * Math.sin(index / 23);
  const jitter = (Math.sin(index * 12.9898) * 43758.5453) % 1;

  return Math.min(1, Math.max(0.12, swell + Math.abs(jitter) * 0.35));
});

type WaveformStatus = "waiting" | "loading" | "ready" | "unavailable";

type ClipEdge = "start" | "end";

interface TrackWaveformProps {
  active: boolean;
  file?: File;
  fallbackDuration: number;
  clip?: TrackClip;
  onClipChange: (clip: TrackClip | undefined) => void;
  trailing?: ReactNode;
}

const clipInset = (from: number, to: number) =>
  `inset(0 ${Math.max(0, 100 - to * 100)}% 0 ${Math.max(0, from * 100)}%)`;

function useTrackWaveform({
  active,
  file,
  fallbackDuration,
  clip,
  onClipChange,
  trailing,
}: TrackWaveformProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ kind: "seek" } | { kind: "edge"; edge: ClipEdge } | null>(null);

  const {
    playbackFile,
    waveform,
    status,
    duration,
    playbackFailed,
    setPlaybackFailed,
    setMediaDuration,
  } = useWaveformSource(audioRef, file, fallbackDuration);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(clip?.start ?? 0);
  const [draftClip, setDraftClip] = useState<TrackClip | null>(null);
  const [width, setWidth] = useState(0);

  const range = draftClip ?? normalizeClip(clip, duration) ?? fullClip(duration);
  const canPlay = active && Boolean(playbackFile) && !playbackFailed && duration > 0;
  const position = Math.min(duration, Math.max(0, currentTime));
  const ratio = (time: number) => (duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0);
  const clipped = normalizeClip(range, duration) !== undefined;
  // Hold the last clip so the label doesn't flash the full range while it fades out on reset.
  const [labelRange, setLabelRange] = useState(range);

  if (clipped && (labelRange.start !== range.start || labelRange.end !== range.end)) {
    setLabelRange(range);
  }

  useLayoutEffect(() => {
    const surface = surfaceRef.current;

    if (!surface) return;
    setWidth(surface.clientWidth);

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });

    observer.observe(surface);

    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (active) return;
    audioRef.current?.pause();
  }, [active]);

  // timeupdate fires a few times a second; follow the playhead per frame while playing and
  // stop at the clip end.
  const rangeRef = useRef(range);
  useLayoutEffect(() => {
    rangeRef.current = range;
  });
  useEffect(() => {
    if (!playing) return;
    let frame = 0;

    const tick = () => {
      const audio = audioRef.current;

      if (!audio) return;
      const { start, end } = rangeRef.current;

      if (audio.currentTime >= end) {
        audio.pause();
        audio.currentTime = start;
        setCurrentTime(start);

        return;
      }

      setCurrentTime(audio.currentTime);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const seekTo = useCallback((time: number) => {
    const audio = audioRef.current;
    const { start, end } = rangeRef.current;
    const next = Math.min(end, Math.max(start, time));

    if (audio) audio.currentTime = next;
    setCurrentTime(next);
  }, []);

  const togglePlayback = async () => {
    const audio = audioRef.current;

    if (!audio || !canPlay) return;

    if (!audio.paused) {
      audio.pause();

      return;
    }

    if (audio.currentTime < range.start || audio.currentTime >= range.end - 0.05) {
      audio.currentTime = range.start;
      setCurrentTime(range.start);
    }

    try {
      await audio.play();
    } catch {
      setPlaybackFailed(true);
    }
  };

  const resetClip = () => {
    const audio = audioRef.current;

    if (audio) audio.currentTime = 0;
    setCurrentTime(0);
    onClipChange(undefined);
  };

  const commitClip = (next: TrackClip) => {
    setDraftClip(null);
    onClipChange(normalizeClip(next, duration));
  };

  const pointerTime = (event: PointerEvent<HTMLElement>) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();

    return bounds ? getPointerTime(event.clientX, bounds.left, bounds.width, duration) : 0;
  };

  const dragEdge = (edge: ClipEdge, time: number) => {
    const next = moveClipEdge(range, edge, time, duration);
    setDraftClip(next);

    // Keep the playhead inside the clip so the next play starts where the user expects.
    if (edge === "start") seekTo(next.start);
    else if (currentTime > next.end) seekTo(next.end);

    return next;
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>, edge?: ClipEdge) => {
    if (!canPlay || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = edge ? { kind: "edge", edge } : { kind: "seek" };

    if (edge) dragEdge(edge, pointerTime(event));
    else seekTo(pointerTime(event));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;

    if (!drag) return;

    if (drag.kind === "edge") dragEdge(drag.edge, pointerTime(event));
    else seekTo(pointerTime(event));
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;

    if (drag?.kind === "edge" && draftClip) commitClip(draftClip);
  };

  const handlePositionKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canPlay) return;
    const step = event.shiftKey ? 15 : 5;

    const actions = new Map<string, () => void>([
      ["ArrowLeft", () => seekTo(position - step)],
      ["ArrowRight", () => seekTo(position + step)],
      ["Home", () => seekTo(range.start)],
      ["End", () => seekTo(range.end)],
      [" ", () => void togglePlayback()],
      ["Enter", () => void togglePlayback()],
    ]);

    const action = actions.get(event.key);

    if (!action) return;
    event.preventDefault();
    action();
  };

  const handleEdgeKeyDown = (edge: ClipEdge) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canPlay) return;
    event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    const current = range[edge];

    const targets = new Map([
      ["ArrowLeft", current - step],
      ["ArrowDown", current - step],
      ["ArrowRight", current + step],
      ["ArrowUp", current + step],
      ["Home", edge === "start" ? 0 : range.start],
      ["End", edge === "end" ? duration : range.end],
    ]);

    const target = targets.get(event.key);

    if (target === undefined) return;
    event.preventDefault();
    commitClip(dragEdge(edge, target));
  };

  const statusMessage = playbackFailed
    ? "this audio format can't be previewed here"
    : status === "unavailable"
      ? "waveform unavailable for this track"
      : null;

  const barCount = Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP));
  const bars = width > 0 ? resamplePeaks(waveform?.peaks ?? PLACEHOLDER_PEAKS, barCount) : [];
  const startRatio = ratio(range.start);
  const endRatio = ratio(range.end);
  const progressRatio = ratio(position);

  return {
    active,
    trailing,
    audioRef,
    surfaceRef,
    canPlay,
    playing,
    togglePlayback,
    status,
    statusMessage,
    clipped,
    labelRange,
    range,
    duration,
    position,
    startRatio,
    endRatio,
    progressRatio,
    resetClip,
    waveform,
    bars,
    startDrag,
    handlePointerMove,
    endDrag,
    handlePositionKeyDown,
    handleEdgeKeyDown,
    setMediaDuration,
    setCurrentTime,
    setPlaying,
    rangeRef,
    playbackFile,
    setPlaybackFailed,
  };
}

export default function TrackWaveform(props: TrackWaveformProps) {
  const {
    trailing,
    audioRef,
    surfaceRef,
    canPlay,
    playing,
    togglePlayback,
    status,
    statusMessage,
    clipped,
    labelRange,
    range,
    duration,
    position,
    startRatio,
    endRatio,
    progressRatio,
    resetClip,
    waveform,
    bars,
    startDrag,
    handlePointerMove,
    endDrag,
    handlePositionKeyDown,
    handleEdgeKeyDown,
    setMediaDuration,
    setCurrentTime,
    setPlaying,
    rangeRef,
    playbackFile,
    setPlaybackFailed,
  } = useTrackWaveform(props);

  return (
    <section
      data-track-waveform
      data-waveform-status={status}
      aria-label="audio preview"
      className="relative flex min-w-0 flex-col px-3 pt-4.5"
    >
      {/* Caption mirrors the inset labels on the metadata fields above. */}
      <div className="absolute top-0 right-3 left-3 flex items-center gap-3 text-[0.6875rem] leading-tight tracking-widest text-muted-foreground">
        <span>preview</span>
        <span role="status" className="ml-auto truncate text-right">
          {statusMessage ?? trailing}
        </span>
      </div>
      {/* react-doctor-disable-next-line media-has-caption -- previews play user-provided music files with no timed text. */}
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={(event) => {
          setMediaDuration(normalizeSeconds(event.currentTarget.duration));
          event.currentTarget.currentTime = rangeRef.current.start;
        }}
        onDurationChange={(event) =>
          setMediaDuration(normalizeSeconds(event.currentTarget.duration))
        }
        onPlay={() => setPlaying(true)}
        onPause={(event) => {
          setPlaying(false);
          setCurrentTime(event.currentTarget.currentTime);
        }}
        onEnded={(event) => {
          event.currentTarget.currentTime = rangeRef.current.start;
          setCurrentTime(rangeRef.current.start);
        }}
        onError={() => {
          if (playbackFile) setPlaybackFailed(true);
        }}
      />
      <div className="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          onClick={() => void togglePlayback()}
          disabled={!canPlay}
          aria-label={playing ? "pause" : "play"}
        >
          <IconSwap
            switched={playing}
            first={
              <svg viewBox="0 0 16 16" className="size-4 translate-x-px fill-current">
                <path d="M3 1.5 14.5 8 3 14.5Z" />
              </svg>
            }
            second={
              <svg viewBox="0 0 16 16" className="size-4 fill-current">
                <path d="M3 2h3.5v12H3ZM9.5 2H13v12H9.5Z" />
              </svg>
            }
          />
        </Button>
        {/* The padding leaves room for clip handles, which sit just outside the clip. */}
        <div className="relative min-w-0 flex-1 px-2">
          <div
            aria-hidden={!clipped}
            inert={!clipped}
            className={cn(
              "absolute bottom-full left-1/2 mb-0.5 flex -translate-x-1/2 items-center gap-1.5 text-[0.6875rem] leading-tight tracking-widest whitespace-nowrap text-muted-foreground transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none",
              clipped ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0",
            )}
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-muted py-px pr-0.5 pl-2 text-foreground/80">
              <span className="tabular-nums">
                clip {formatTimestamp(labelRange.start)}–{formatTimestamp(labelRange.end)}
              </span>
              <button
                type="button"
                aria-label="reset clip"
                className="inline-flex size-4 cursor-pointer items-center justify-center rounded-full transition-colors outline-none text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={resetClip}
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.5} className="size-2.5" />
              </button>
            </span>
          </div>
          <div
            ref={surfaceRef}
            role="slider"
            tabIndex={canPlay ? 0 : -1}
            aria-label="playback position"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(position)}
            aria-valuetext={`${formatTimestamp(position)} of ${formatTimestamp(duration)}`}
            aria-disabled={!canPlay}
            onPointerDown={(event) => startDrag(event)}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={handlePositionKeyDown}
            className={cn(
              "relative min-w-0 touch-none select-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              canPlay ? "cursor-pointer" : "cursor-default",
            )}
            style={{ height: WAVEFORM_HEIGHT }}
          >
            {waveform ? (
              <>
                <WaveformBars bars={bars} className="fill-muted-foreground/25" />
                <WaveformBars
                  bars={bars}
                  className="fill-muted-foreground/70"
                  clipPath={clipInset(startRatio, endRatio)}
                />
                <WaveformBars
                  bars={bars}
                  className="fill-primary"
                  clipPath={clipInset(startRatio, progressRatio)}
                />
              </>
            ) : (
              <WaveformBars bars={bars} className="fill-muted-foreground/20" />
            )}
            {canPlay && (
              <>
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
                  style={{ left: `${progressRatio * 100}%` }}
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 border border-x-primary/60 border-y-primary/20"
                  style={{
                    left: `${startRatio * 100}%`,
                    right: `${100 - endRatio * 100}%`,
                  }}
                />
                <ClipHandle
                  edge="start"
                  ratio={startRatio}
                  value={range.start}
                  duration={duration}
                  onPointerDown={(event) => startDrag(event, "start")}
                  onKeyDown={handleEdgeKeyDown("start")}
                />
                <ClipHandle
                  edge="end"
                  ratio={endRatio}
                  value={range.end}
                  duration={duration}
                  onPointerDown={(event) => startDrag(event, "end")}
                  onKeyDown={handleEdgeKeyDown("end")}
                />
              </>
            )}
          </div>
        </div>
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
          <span className="text-foreground">{formatTimestamp(position)}</span>
          {" / "}
          {formatTimestamp(duration)}
        </span>
      </div>
    </section>
  );
}

function useWaveformSource(
  audioRef: RefObject<HTMLAudioElement | null>,
  file: File | undefined,
  fallbackDuration: number,
) {
  // Metadata writes replace the track's File without touching its audio; keep the first one
  // so playback is not interrupted by a reload.
  const [playbackFile, setPlaybackFile] = useState(file);

  if (!playbackFile && file) setPlaybackFile(file);
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [status, setStatus] = useState<WaveformStatus>(file ? "loading" : "waiting");
  const [mediaDuration, setMediaDuration] = useState(0);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  useEffect(() => {
    const audio = audioRef.current;

    if (!playbackFile || !audio) return;
    // react-doctor-disable-next-line no-create-object-url-without-revoke -- revoked in the cleanup below.
    const objectUrl = URL.createObjectURL(playbackFile);
    audio.src = objectUrl;
    audio.load();

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(objectUrl);
    };
  }, [audioRef, playbackFile]);

  const decodeDuration = normalizeSeconds(fallbackDuration) || normalizeSeconds(mediaDuration);
  useEffect(() => {
    if (!playbackFile || decodeDuration === 0) return;
    let current = true;
    setStatus("loading");
    loadWaveform(playbackFile, decodeDuration).then(
      (data) => {
        if (!current) return;
        setWaveform(data);
        setStatus("ready");
      },
      () => {
        if (current) setStatus("unavailable");
      },
    );

    return () => {
      current = false;
    };
  }, [decodeDuration, playbackFile]);

  const duration =
    normalizeSeconds(mediaDuration) ||
    normalizeSeconds(waveform?.duration) ||
    normalizeSeconds(fallbackDuration);

  return {
    playbackFile,
    waveform,
    status,
    duration,
    playbackFailed,
    setPlaybackFailed,
    setMediaDuration,
  };
}

function ClipHandle({
  edge,
  ratio,
  value,
  duration,
  onPointerDown,
  onKeyDown,
}: {
  edge: ClipEdge;
  ratio: number;
  value: number;
  duration: number;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={edge === "start" ? "clip start" : "clip end"}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={formatTimestamp(value)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute inset-y-0 z-10 flex w-2 cursor-ew-resize items-center justify-center bg-primary/60 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        edge === "start" ? "-translate-x-full rounded-l-sm" : "rounded-r-sm",
      )}
      style={{ left: `${ratio * 100}%` }}
    >
      <span className="h-3 w-px bg-primary-foreground/80" />
    </div>
  );
}

function WaveformBars({
  bars,
  className,
  clipPath,
}: {
  bars: number[];
  className: string;
  clipPath?: string;
}) {
  const width = Math.max(1, bars.length * (BAR_WIDTH + BAR_GAP) - BAR_GAP);
  // Bars mirror around a 1px divider through the vertical center; the lower half is fainter.
  const half = (WAVEFORM_HEIGHT - 1) / 2;

  return (
    <svg
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 top-1 h-[calc(100%-0.5rem)] w-full",
        className,
      )}
      viewBox={`0 0 ${width} ${WAVEFORM_HEIGHT}`}
      preserveAspectRatio="none"
      style={clipPath ? { clipPath } : undefined}
    >
      {bars.map((bar, index) => {
        const x = index * (BAR_WIDTH + BAR_GAP);
        const height = Math.max(1, bar * half);

        return (
          <g key={index}>
            <rect x={x} y={half - height} width={BAR_WIDTH} height={height} />
            <rect x={x} y={half + 1} width={BAR_WIDTH} height={height} opacity={0.45} />
          </g>
        );
      })}
    </svg>
  );
}
