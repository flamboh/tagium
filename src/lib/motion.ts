/** Returns whether the user has requested reduced motion. */
export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/**
 * Grows a newly inserted row from zero height while its content slides down into place, so
 * neighbouring rows shift smoothly instead of jumping. Clips the row for the duration and
 * returns a cancel function for effect cleanup. No-op under reduced motion.
 */
export function animateRowEnter(row: HTMLElement, content: HTMLElement | null): () => void {
  if (prefersReducedMotion() || typeof row.animate !== "function") return () => {};

  const timing = { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };
  const previousOverflow = row.style.overflow;
  row.style.overflow = "hidden";
  const restoreOverflow = () => {
    row.style.overflow = previousOverflow;
  };

  const rowAnimation = row.animate(
    [{ height: "0px" }, { height: `${row.offsetHeight}px` }],
    timing,
  );
  rowAnimation.addEventListener("finish", restoreOverflow);
  const contentAnimation = content?.animate(
    [
      { opacity: 0, transform: "translateY(-28px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    timing,
  );

  return () => {
    rowAnimation.cancel();
    contentAnimation?.cancel();
    restoreOverflow();
  };
}
