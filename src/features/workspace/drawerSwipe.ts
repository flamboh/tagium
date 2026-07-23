import { useEffect, useRef } from "react";

export type DrawerSwipeDirection = "open" | "close";

export interface DrawerSwipeSample {
  x: number;
  y: number;
  time: number;
}

const INTENT_SLOP = 12;
const COMMIT_DISTANCE = 64;
const FLICK_DISTANCE = 32;
const FLICK_VELOCITY = 0.5;

export const decideDrawerSwipe = (
  samples: readonly DrawerSwipeSample[],
  direction: DrawerSwipeDirection,
) => {
  const start = samples[0];
  const end = samples.at(-1);
  if (!start || !end) return "reject" as const;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = direction === "open" ? dx : -dx;
  if (distance <= 0 || Math.abs(dy) > Math.max(24, Math.abs(dx) / 2)) return "reject" as const;
  if (distance >= COMMIT_DISTANCE) return "commit" as const;
  if (distance < FLICK_DISTANCE) return "reject" as const;

  const previous =
    samples
      .slice(0, -1)
      .reverse()
      .find((sample) => sample.x !== end.x) ?? start;
  const finalDelta = direction === "open" ? end.x - previous.x : previous.x - end.x;
  if (finalDelta < 0) return "reject" as const;
  const recent = [...samples].reverse().find((sample) => end.time - sample.time >= 80) ?? start;
  const elapsed = Math.max(1, end.time - recent.time);
  const velocity = (direction === "open" ? end.x - recent.x : recent.x - end.x) / elapsed;
  return velocity >= FLICK_VELOCITY ? "commit" : "reject";
};

interface ActiveSwipe {
  identifier: number;
  axis: "pending" | "horizontal";
  samples: DrawerSwipeSample[];
}

const findTouch = (touches: TouchList, identifier: number) =>
  Array.from(touches).find((touch) => touch.identifier === identifier);

export const isDrawerSwipeInteractiveTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest(
    'button,a,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="slider"],[data-drawer-swipe-ignore]',
  );

export const useDrawerSwipe = ({
  enabled,
  direction,
  onCommit,
  onSurfaceClick,
  startsInZone,
}: {
  enabled: boolean;
  direction: DrawerSwipeDirection;
  onCommit: () => void;
  onSurfaceClick?: () => void;
  startsInZone: (touch: Touch, surface: HTMLElement) => boolean;
}) => {
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !enabled) return;
    const activeSurface: HTMLDivElement = surface;
    let active: ActiveSwipe | null = null;
    let removeSecondTouchListener: (() => void) | undefined;
    const clear = () => {
      active = null;
      removeSecondTouchListener?.();
      removeSecondTouchListener = undefined;
      activeSurface.removeEventListener("touchmove", onMove);
      activeSurface.removeEventListener("touchend", onEnd);
      activeSurface.removeEventListener("touchcancel", clear);
    };
    const cancelOnSecondTouch = (event: TouchEvent) => {
      if (active && event.touches.length > 1) clear();
    };
    function onStart(event: TouchEvent) {
      if (active || event.touches.length !== 1) return;
      const touch = event.changedTouches[0];
      if (
        !touch ||
        isDrawerSwipeInteractiveTarget(event.target) ||
        !startsInZone(touch, activeSurface)
      ) {
        return;
      }
      active = {
        identifier: touch.identifier,
        axis: "pending",
        samples: [{ x: touch.clientX, y: touch.clientY, time: event.timeStamp }],
      };
      document.addEventListener("touchstart", cancelOnSecondTouch, {
        capture: true,
        passive: true,
      });
      removeSecondTouchListener = () =>
        document.removeEventListener("touchstart", cancelOnSecondTouch, true);
      activeSurface.addEventListener("touchmove", onMove, { passive: false });
      activeSurface.addEventListener("touchend", onEnd, { passive: true });
      activeSurface.addEventListener("touchcancel", clear, { passive: true });
    }
    function onMove(event: TouchEvent) {
      if (!active || event.touches.length !== 1) return clear();
      const touch = findTouch(event.touches, active.identifier);
      if (!touch) return clear();
      const start = active.samples[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (active.axis === "pending") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < INTENT_SLOP) return;
        if (Math.abs(dx) >= Math.abs(dy) * 1.5) {
          if ((direction === "open" && dx < 0) || (direction === "close" && dx > 0)) {
            return clear();
          }
          active.axis = "horizontal";
        } else {
          return clear();
        }
      }
      active.samples.push({ x: touch.clientX, y: touch.clientY, time: event.timeStamp });
      event.preventDefault();
    }
    function onEnd(event: TouchEvent) {
      if (!active) return;
      const touch = findTouch(event.changedTouches, active.identifier);
      if (!touch) return;
      active.samples.push({ x: touch.clientX, y: touch.clientY, time: event.timeStamp });
      const shouldCommit =
        active.axis === "horizontal" && decideDrawerSwipe(active.samples, direction) === "commit";
      clear();
      if (shouldCommit) onCommit();
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") clear();
    };
    const onClick = () => onSurfaceClick?.();

    activeSurface.addEventListener("touchstart", onStart, { passive: true });
    activeSurface.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      activeSurface.removeEventListener("touchstart", onStart);
      activeSurface.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clear();
    };
  }, [direction, enabled, onCommit, onSurfaceClick, startsInZone]);

  return surfaceRef;
};
