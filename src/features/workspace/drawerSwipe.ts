export type SwipePoint = { clientX: number; clientY: number; pointerType?: string; pointerId?: number };

export const MOBILE_DRAWER_EDGE_FRACTION = 0.4;
export const MOBILE_DRAWER_SETTLE_PX = 64;

export type SwipeDecision = "open" | "ignore" | "tracking";

export const isDrawerSwipeOptOut = (tagName: string) =>
  ["input", "textarea", "select", "contenteditable", "data-drawer-swipe-optout"].includes(
    tagName.toLowerCase(),
  );

export const isDrawerSwipeScrollOptOut = (
  overflowX: string,
  scrollWidth: number,
  clientWidth: number,
) => (overflowX === "auto" || overflowX === "scroll") && scrollWidth > clientWidth;

export const shouldStartDrawerSwipe = (
  point: SwipePoint,
  viewportWidth: number,
  target?: EventTarget | null,
) => {
  if (point.pointerType === "mouse" || point.pointerType === "pen") return false;
  if (point.clientX > viewportWidth * MOBILE_DRAWER_EDGE_FRACTION || point.clientX < 0 || point.clientY < 0) return false;
  if (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    (target.closest("[data-drawer-swipe-optout], input, textarea, select, [contenteditable='true']") ||
      (() => {
        let node: Element | null = target;
        while (node) {
          const style = window.getComputedStyle(node);
          if (isDrawerSwipeScrollOptOut(style.overflowX, node.scrollWidth, node.clientWidth)) return true;
          node = node.parentElement;
        }
        return false;
      })())
  ) {
    return false;
  }
  return viewportWidth > 0;
};

export const decideDrawerSwipe = (start: SwipePoint, current: SwipePoint): SwipeDecision => {
  const dx = current.clientX - start.clientX;
  const dy = Math.abs(current.clientY - start.clientY);
  if (dx < 0) return "ignore";
  if (Math.abs(dx) < 12 && dy < 12) return "tracking";
  if (dx <= 0 || Math.abs(dx) < dy * 1.5) return "ignore";
  return dx >= MOBILE_DRAWER_SETTLE_PX ? "open" : "tracking";
};
