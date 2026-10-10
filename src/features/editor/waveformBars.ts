import { useEffect, useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { resamplePeaks } from "@/features/editor/waveform";

export const WAVEFORM_HEIGHT = 44;

const BAR_WIDTH = 2;

const BAR_GAP = 1;

const TWEEN_MS = 300;

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
  const half = (WAVEFORM_HEIGHT - 1) / 2;
  let upper = "";
  let lower = "";

  for (const [index, bar] of bars.entries()) {
    const x = index * (BAR_WIDTH + BAR_GAP);
    const height = Math.max(1, bar * half);
    upper += `M${x} ${half - height}h${BAR_WIDTH}v${height}h${-BAR_WIDTH}Z`;
    lower += `M${x} ${half + 1}h${BAR_WIDTH}v${height}h${-BAR_WIDTH}Z`;
  }

  return { upper, lower };
};

const loadingWave = (count: number, seconds: number) => {
  const center = 0.5 - 0.45 * Math.cos((2 * Math.PI * seconds) / 3.2);

  return Array.from({ length: count }, (_, index) => {
    const x = (index + 0.5) / count;
    const envelope = Math.exp(-0.5 * ((x - center) / 0.18) ** 2);
    const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * (3 * x - seconds / 1.2));

    return 0.12 + 0.2 * pulse + 0.5 * envelope * (0.35 + 0.65 * pulse);
  });
};

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

type Goal = { kind: "wave" } | { kind: "hold" } | { kind: "peaks"; peaks: number[] };

interface BarsInput {
  peaks: number[] | null;
  loading: boolean;
  barCount: number;
  active: boolean;
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function createBarsController() {
  const svgs = new Set<SVGSVGElement>();
  let input: BarsInput = { peaks: null, loading: false, barCount: 0, active: false };
  let motion = !window.matchMedia(reducedMotionQuery).matches;
  let visible = document.visibilityState === "visible";
  let intersecting = true;
  let count = 0;
  let goal: Goal = { kind: "hold" };
  let goalBars: number[] = [];
  let heights: number[] | null = null;
  let paths = { upper: "", lower: "" };
  let from: number[] | null = null;
  let blend = 0;
  let clock = 0;
  let previous: number | null = null;
  let frame = 0;

  const write = (svg: SVGSVGElement) => {
    svg.children[0]?.setAttribute("d", paths.upper);
    svg.children[1]?.setAttribute("d", paths.lower);
  };

  const paint = (bars: number[]) => {
    heights = bars.length > 0 ? bars : null;
    paths = barPaths(bars);

    for (const svg of svgs) write(svg);
  };

  const target = () => (goal.kind === "wave" ? loadingWave(count, clock) : goalBars);

  const step = (now: number) => {
    const elapsed = previous === null ? 0 : Math.max(0, now - previous);
    previous = now;

    if (goal.kind === "wave") clock += elapsed / 1000;
    const next = target();
    const start = from;

    if (start) {
      blend += elapsed;
      const progress = Math.min(1, blend / TWEEN_MS);
      const eased = 1 - (1 - progress) ** 4;
      paint(
        progress < 1
          ? next.map((bar, index) => start[index]! + (bar - start[index]!) * eased)
          : next,
      );

      if (progress >= 1) from = null;
    } else {
      paint(next);
    }

    frame = goal.kind === "wave" || from ? requestAnimationFrame(step) : 0;
  };

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = null;
  };

  const nextGoal = (): Goal => {
    if (input.peaks) return { kind: "peaks", peaks: input.peaks };

    if (motion && input.loading) return { kind: "wave" };

    if (motion && heights && goal.kind !== "peaks") return { kind: "hold" };

    return { kind: "peaks", peaks: PLACEHOLDER_PEAKS };
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
      from = motion && heights && upcoming.kind !== "hold" ? heights : null;
      blend = 0;
      goal = upcoming;
    }

    if (goal.kind !== "peaks") goalBars = heights ?? [];
    else goalBars = count > 0 ? resamplePeaks(goal.peaks, count) : [];
    const running = input.active && intersecting && visible && motion && count > 0;
    cancelAnimationFrame(frame);

    if (running && (goal.kind === "wave" || from)) {
      step(performance.now());

      return;
    }

    stop();
    from = null;
    paint(target());
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

export function useWaveformBars(surfaceRef: RefObject<HTMLElement | null>, input: BarsInput) {
  const [controller] = useState(createBarsController);
  const { peaks, loading, barCount, active } = input;

  useLayoutEffect(() => {
    controller.update({ peaks, loading, barCount, active });
  }, [controller, peaks, loading, barCount, active]);

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
