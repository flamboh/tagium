import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type IconSwapProps = {
  switched: boolean;
  first: ReactNode;
  second: ReactNode;
  className?: string;
};

export const iconSwapDurationMs = 200;

/** Crossfades two overlapping icons while keeping both mounted in the same slot. */
export function IconSwap({ switched, first, second, className }: IconSwapProps) {
  return (
    <span
      data-icon-swap-state={switched ? "second" : "first"}
      className={cn("pointer-events-none relative size-4", className)}
      aria-hidden="true"
    >
      <span
        data-icon-swap="first"
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none motion-reduce:delay-0",
          switched
            ? "opacity-0 blur-[2px] scale-50 delay-0"
            : "opacity-100 blur-none scale-100 delay-[40ms]",
        )}
      >
        {first}
      </span>
      <span
        data-icon-swap="second"
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none motion-reduce:delay-0",
          switched
            ? "opacity-100 blur-none scale-100 delay-[40ms]"
            : "opacity-0 blur-[2px] scale-50 delay-0",
        )}
      >
        {second}
      </span>
    </span>
  );
}
