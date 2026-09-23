import type { ReactNode } from "react";
import { LazyMotion, MotionConfig } from "motion/react";

/**
 * Loads Motion's animation features on demand and honours the OS reduced-motion setting for
 * every `m.*` element beneath it. Use `m` from "motion/react" (never `motion`) so the feature
 * bundle stays lazy.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={() => import("@/lib/motion-features").then((mod) => mod.default)}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
