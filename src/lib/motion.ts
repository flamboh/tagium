/** Expo-out timing shared by every row entrance and exit. */
export const rowTransition = { duration: 0.3, ease: [0.16, 1, 0.3, 1] } as const;

/**
 * Presence props for the clipping shell of a list row: it grows from zero height so neighbours
 * slide instead of jumping, and collapses again on exit. Pair with `rowContent` on the child.
 */
export const rowShell = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: rowTransition,
  style: { overflow: "hidden" },
} as const;

/** Presence props for a row's content: it slides down from under the previous row. */
export const rowContent = {
  initial: { y: -28 },
  animate: { y: 0 },
  exit: { y: -12 },
  transition: rowTransition,
} as const;

/** Presence props for a small block that should simply fade in and out. */
export const fadePresence = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
} as const;

/** Timing for the media url entry as it moves between the landing and editor positions. */
export const morphTransition = { duration: 0.42, ease: [0.22, 1, 0.36, 1] } as const;
