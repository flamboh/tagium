import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type IconSwapProps = {
  switched: boolean;
  first: ReactNode;
  second: ReactNode;
  className?: string;
};

export const iconSwapDurationMs = 80;

/** Hides one icon through blur before revealing its replacement in the same slot. */
export function IconSwap({ switched, first, second, className }: IconSwapProps) {
  const [displayedSecond, setDisplayedSecond] = useState(switched);
  const [hidden, setHidden] = useState(false);
  const displayedSecondRef = useRef(switched);
  const swapTimeoutRef = useRef<number | null>(null);
  const revealFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      displayedSecondRef.current = switched;
      setDisplayedSecond(switched);
      setHidden(false);
      return;
    }

    const clearScheduledSwap = () => {
      if (swapTimeoutRef.current !== null) window.clearTimeout(swapTimeoutRef.current);
      if (revealFrameRef.current !== null) window.cancelAnimationFrame(revealFrameRef.current);
      swapTimeoutRef.current = null;
      revealFrameRef.current = null;
    };

    clearScheduledSwap();

    if (switched === displayedSecondRef.current) {
      setHidden(false);
      return clearScheduledSwap;
    }

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      displayedSecondRef.current = switched;
      setDisplayedSecond(switched);
      setHidden(false);
      return clearScheduledSwap;
    }

    setHidden(true);
    swapTimeoutRef.current = window.setTimeout(() => {
      displayedSecondRef.current = switched;
      setDisplayedSecond(switched);
      swapTimeoutRef.current = null;
      revealFrameRef.current = window.requestAnimationFrame(() => {
        setHidden(false);
        revealFrameRef.current = null;
      });
    }, iconSwapDurationMs);

    return clearScheduledSwap;
  }, [switched]);

  return (
    <span
      data-icon-swap-state={displayedSecond ? "second" : "first"}
      data-icon-swap-phase={hidden ? "hidden" : "visible"}
      className={cn("pointer-events-none relative size-4", className)}
      aria-hidden="true"
    >
      <span
        data-icon-swap="icon"
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-[filter,opacity] duration-[80ms] ease-linear motion-reduce:transition-none",
          hidden ? "opacity-0 blur-[2px]" : "opacity-100 blur-none",
        )}
      >
        {displayedSecond ? second : first}
      </span>
    </span>
  );
}
