import { useEffect, useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { resamplePeaks } from "@/features/editor/waveform";

export const WAVEFORM_HEIGHT = 44;

const BAR_WIDTH = 2;

const BAR_GAP = 1;

const BAR_HALF = (WAVEFORM_HEIGHT - 1) / 2;

const TWEEN_MS = 350;

// Stands in for the real peaks while the track downloads or decodes.
const PLACEHOLDER_PEAKS = Array.from({ length: 256 }, (_, index) => {
  const swell = 0.45 + 0.3 * Math.sin(index / 9) * Math.sin(index / 23);
  const jitter = (Math.sin(index * 12.9898) * 43758.5453) % 1;

  return Math.min(1, Math.max(0.12, swell + Math.abs(jitter) * 0.35));
});

export const barCountForWidth = (width: number) =>
  Math.max(0, Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP)));

export const barsViewBox = (count: number) =>
  `0 0 ${Math.max(1, count * (BAR_WIDTH + BAR_GAP) - BAR_GAP)} ${WAVEFORM_HEIGHT}`;

// Bars mirror around a 1px divider through the vertical center; the lower half is fainter.
const barPaths = (bars: number[]) => {
  let upper = "";
  let lower = "";

  for (const [index, bar] of bars.entries()) {
    const x = index * (BAR_WIDTH + BAR_GAP);
    const height = Math.max(1, bar * BAR_HALF);
    upper += `M${x} ${BAR_HALF - height}h${BAR_WIDTH}v${height}h${-BAR_WIDTH}Z`;
    lower += `M${x} ${BAR_HALF + 1}h${BAR_WIDTH}v${height}h${-BAR_WIDTH}Z`;
  }

  return { upper, lower };
};

const LOADING_SEED = 11;

const LOADING_FLOOR = 2;

const LOADING_RANGE = 16;

const hash = (seed: number, value: number) => {
  let mixed = Math.imul(seed ^ Math.imul(value, 0x9e3779b1), 0x6d2b79f5);
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
};

const approach = (elapsed: number, timeConstant: number) => 1 - Math.exp(-elapsed / timeConstant);

const smoothstep = (progress: number) => progress * progress * (3 - 2 * progress);

const envelope = (x: number) => 0.15 + 0.85 * Math.min(1, 14 * x, 14 * (1 - x));

const loudness = (key: number) => 0.8 + 0.2 * hash(LOADING_SEED + 3, key);

const loudnessHold = (key: number) => 900 + 600 * hash(LOADING_SEED + 4, key);

const flicker = (index: number, clock: number) => {
  const period = 160 + 60 * hash(LOADING_SEED, index);
  const offset = 60 * hash(LOADING_SEED + 1, index);
  const key = Math.floor((clock + offset) / period);

  return 0.35 + 0.65 * hash(LOADING_SEED + 2, index * 7919 + key);
};

const loadingFloor = (count: number) =>
  Array.from({ length: count }, () => LOADING_FLOOR / BAR_HALF);

function createLoadingWave() {
  let clock = 0;
  let key = 0;
  let level = loudness(0);
  let levelEnds = loudnessHold(0);

  return (heights: number[], elapsed: number) => {
    clock += elapsed;

    while (clock >= levelEnds) {
      key += 1;
      levelEnds += loudnessHold(key);
    }

    level += (loudness(key) - level) * approach(elapsed, 540);
    const ease = approach(elapsed, 70);
    const last = Math.max(1, heights.length - 1);

    return heights.map((height, index) => {
      const x = heights.length > 1 ? index / last : 0.5;

      const target =
        (LOADING_FLOOR + LOADING_RANGE * envelope(x) * level * flicker(index, clock)) / BAR_HALF;

      return height + (target - height) * ease;
    });
  };
}

const resampleLinear = (values: number[], count: number) => {
  if (values.length === 0 || count <= 0) return [];

  if (values.length === 1) return Array.from({ length: count }, () => values[0]!);

  return Array.from({ length: count }, (_, index) => {
    const position = count === 1 ? 0 : (index / (count - 1)) * (values.length - 1);
    const left = Math.floor(position);
    const right = Math.min(values.length - 1, left + 1);

    return values[left]! + (values[right]! - values[left]!) * (position - left);
  });
};

type Goal =
  | { kind: "loading" }
  | { kind: "hold" }
  | { kind: "placeholder"; peaks: number[] }
  | { kind: "peaks"; peaks: number[] };

interface BarsInput {
  surface: HTMLElement | null;
  peaks: number[] | null;
  loading: boolean;
  barCount: number;
  active: boolean;
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function createBarsController() {
  const svgs = new Set<SVGSVGElement>();

  let input: BarsInput = {
    surface: null,
    peaks: null,
    loading: false,
    barCount: 0,
    active: false,
  };

  let motion = !window.matchMedia(reducedMotionQuery).matches;
  let visible = document.visibilityState === "visible";
  let intersecting = true;
  let count = 0;
  let goal: Goal = { kind: "hold" };
  let goalBars: number[] = [];
  let heights: number[] | null = null;
  let paths = { upper: "", lower: "" };
  let ready: number | null = null;
  let from: number[] | null = null;
  let blend = 0;
  const wave = createLoadingWave();
  let previous: number | null = null;
  let frame = 0;

  const write = (svg: SVGSVGElement) => {
    svg.children[0]?.setAttribute("d", paths.upper);
    svg.children[1]?.setAttribute("d", paths.lower);
  };

  const paint = (bars: number[], readiness: number) => {
    heights = bars.length > 0 ? bars : null;
    paths = barPaths(bars);

    for (const svg of svgs) write(svg);

    if (readiness === ready) return;
    ready = readiness;
    input.surface?.style.setProperty("--waveform-ready", String(readiness));
  };

  const resting = () => (goal.kind === "loading" ? (heights ?? loadingFloor(count)) : goalBars);

  const settled = () => (goal.kind === "peaks" ? 1 : 0);

  const step = (now: number) => {
    const elapsed = previous === null ? 0 : Math.max(0, now - previous);
    previous = now;
    const start = from;

    if (goal.kind === "loading") {
      paint(wave(resting(), elapsed), 0);
    } else if (start) {
      blend += elapsed;
      const progress = Math.min(1, blend / TWEEN_MS);
      const eased = smoothstep(progress);
      paint(
        progress < 1
          ? goalBars.map((bar, index) => start[index]! + (bar - start[index]!) * eased)
          : goalBars,
        eased,
      );

      if (progress >= 1) from = null;
    } else {
      paint(goalBars, settled());
    }

    frame = goal.kind === "loading" || from ? requestAnimationFrame(step) : 0;
  };

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = null;
  };

  const nextGoal = (): Goal => {
    if (input.peaks) return { kind: "peaks", peaks: input.peaks };

    if (motion && input.loading) return { kind: "loading" };

    if (motion && heights && (goal.kind === "loading" || goal.kind === "hold")) {
      return { kind: "hold" };
    }

    return { kind: "placeholder", peaks: PLACEHOLDER_PEAKS };
  };

  const sync = () => {
    if (input.barCount !== count) {
      count = input.barCount;
      heights = heights && count > 0 ? resampleLinear(heights, count) : null;
      from = from && count > 0 ? resampleLinear(from, count) : null;
    }

    const upcoming = nextGoal();

    const changed =
      upcoming.kind !== goal.kind ||
      (upcoming.kind === "peaks" && goal.kind === "peaks" && upcoming.peaks !== goal.peaks);

    if (changed) {
      from = motion && heights && upcoming.kind === "peaks" ? heights : null;
      blend = 0;
      goal = upcoming;
    }

    if ("peaks" in goal) goalBars = count > 0 ? resamplePeaks(goal.peaks, count) : [];
    else goalBars = heights ?? [];
    const running = input.active && intersecting && visible && motion && count > 0;
    cancelAnimationFrame(frame);

    if (running && (goal.kind === "loading" || from)) {
      step(performance.now());

      return;
    }

    stop();
    from = null;
    paint(resting(), settled());
  };

  return {
    update: (next: BarsInput) => {
      input = next;
      sync();
    },
    environment: (next: { motion?: boolean; visible?: boolean; intersecting?: boolean }) => {
      motion = next.motion ?? motion;
      visible = next.visible ?? visible;
      intersecting = next.intersecting ?? intersecting;
      sync();
    },
    attach: (svg: SVGSVGElement) => {
      svgs.add(svg);
      write(svg);

      return () => {
        svgs.delete(svg);
      };
    },
    stop,
  };
}

export function useWaveformBars(
  surfaceRef: RefObject<HTMLElement | null>,
  input: Omit<BarsInput, "surface">,
) {
  const [controller] = useState(createBarsController);
  const { peaks, loading, barCount, active } = input;

  useLayoutEffect(() => {
    controller.update({ surface: surfaceRef.current, peaks, loading, barCount, active });
  }, [controller, surfaceRef, peaks, loading, barCount, active]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const reducedMotion = window.matchMedia(reducedMotionQuery);
    const handleMotion = () => controller.environment({ motion: !reducedMotion.matches });

    const handleVisibility = () =>
      controller.environment({ visible: document.visibilityState === "visible" });

    const observer = new IntersectionObserver(([entry]) => {
      if (entry) controller.environment({ intersecting: entry.isIntersecting });
    });

    if (surface) observer.observe(surface);
    reducedMotion.addEventListener("change", handleMotion);
    document.addEventListener("visibilitychange", handleVisibility);
    handleMotion();

    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", handleMotion);
      document.removeEventListener("visibilitychange", handleVisibility);
      controller.stop();
    };
  }, [controller, surfaceRef]);

  return controller.attach;
}
