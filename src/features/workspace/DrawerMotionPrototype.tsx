"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// PROTOTYPE: Three drawer easing profiles, switchable with ?drawerMotion=A|B|C.
const variants = {
  A: {
    label: "balanced",
    open: "cubic-bezier(0.25, 1, 0.5, 1)",
    close: "cubic-bezier(0.5, 0, 0.75, 0)",
  },
  B: {
    label: "relaxed",
    open: "cubic-bezier(0.16, 1, 0.3, 1)",
    close: "cubic-bezier(0.7, 0, 0.84, 0)",
  },
  C: {
    label: "crisp",
    open: "cubic-bezier(0.33, 1, 0.68, 1)",
    close: "cubic-bezier(0.32, 0, 0.67, 0)",
  },
} as const;

type DrawerMotionVariant = keyof typeof variants;

const variantKeys = Object.keys(variants) as DrawerMotionVariant[];

const readVariant = (): DrawerMotionVariant | null => {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("drawerMotion");
  return variantKeys.includes(value as DrawerMotionVariant)
    ? (value as DrawerMotionVariant)
    : null;
};

export const useDrawerMotionPrototype = (drawerOpen: boolean) => {
  const [variant, setVariant] = useState<DrawerMotionVariant | null>(readVariant);

  const selectVariant = useCallback((next: DrawerMotionVariant) => {
    const url = new URL(window.location.href);
    url.searchParams.set("drawerMotion", next);
    window.history.replaceState(window.history.state, "", url);
    setVariant(next);
  }, []);

  const cycleVariant = useCallback(
    (direction: -1 | 1) => {
      if (!variant) return;
      const index = variantKeys.indexOf(variant);
      selectVariant(variantKeys[(index + direction + variantKeys.length) % variantKeys.length]);
    },
    [selectVariant, variant],
  );

  useEffect(() => {
    if (!variant) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable='true']")
      ) {
        return;
      }
      event.preventDefault();
      cycleVariant(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cycleVariant, variant]);

  const transitionStyle: CSSProperties | undefined = variant
    ? {
        transitionDuration: drawerOpen ? "230ms" : "190ms",
        transitionTimingFunction: drawerOpen
          ? variants[variant].open
          : variants[variant].close,
      }
    : undefined;

  return { variant, transitionStyle, cycleVariant };
};

export function DrawerMotionPrototypeSwitcher({
  variant,
  onCycle,
}: {
  variant: DrawerMotionVariant | null;
  onCycle: (direction: -1 | 1) => void;
}) {
  if (!variant) return null;

  return (
    <div
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground p-1 text-background shadow-md md:hidden"
      data-drawer-swipe-optout
      aria-label="drawer motion prototype"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 rounded-full text-background hover:bg-background/15 hover:text-background"
        aria-label="previous motion variant"
        onClick={() => onCycle(-1)}
      >
        <ChevronLeft />
      </Button>
      <span className="min-w-28 select-none text-center text-xs font-medium">
        {variant} — {variants[variant].label}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 rounded-full text-background hover:bg-background/15 hover:text-background"
        aria-label="next motion variant"
        onClick={() => onCycle(1)}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
