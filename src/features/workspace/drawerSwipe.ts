export type SwipePoint = {
  clientX: number;
  clientY: number;
  height?: number;
  isPrimary?: boolean;
  pointerType?: string;
  pointerId?: number;
  width?: number;
};

export const MOBILE_DRAWER_EDGE_FRACTION = 0.4;
export const MOBILE_DRAWER_SETTLE_PX = 64;

export type SwipeDirection = "open" | "close";
export type SwipeDecision = SwipeDirection | "ignore" | "tracking";

const isEligibleDrawerSwipePointer = (point: SwipePoint) =>
  point.isPrimary !== false && point.pointerType !== "mouse" && point.pointerType !== "pen";

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
  if (!isEligibleDrawerSwipePointer(point)) return false;
  if (
    point.clientX > viewportWidth * MOBILE_DRAWER_EDGE_FRACTION ||
    point.clientX < 0 ||
    point.clientY < 0
  )
    return false;
  if (
    "Element" in globalThis &&
    target instanceof Element &&
    (target.closest(
      "[data-drawer-swipe-optout], input, textarea, select, [contenteditable='true']",
    ) ||
      (() => {
        let node: Element | null = target;
        while (node) {
          const style = window.getComputedStyle(node);
          if (isDrawerSwipeScrollOptOut(style.overflowX, node.scrollWidth, node.clientWidth))
            return true;
          node = node.parentElement;
        }
        return false;
      })())
  ) {
    return false;
  }
  return viewportWidth > 0;
};

export const getDrawerSwipeDirection = (
  point: SwipePoint,
  viewportWidth: number,
  drawerOpen: boolean,
  target?: EventTarget | null,
): SwipeDirection | null => {
  if (!isEligibleDrawerSwipePointer(point)) return null;
  if (drawerOpen) return "close";
  return shouldStartDrawerSwipe(point, viewportWidth, target) ? "open" : null;
};

export const decideDrawerSwipe = (
  start: SwipePoint,
  current: SwipePoint,
  direction: SwipeDirection,
): SwipeDecision => {
  const rawDx = current.clientX - start.clientX;
  const dx = direction === "open" ? rawDx : -rawDx;
  const dy = Math.abs(current.clientY - start.clientY);
  if (dx < 0) return "ignore";
  if (dx < 12 && dy < 12) return "tracking";
  if (dx <= 0 || dx < dy * 1.5) return "ignore";
  return dx >= MOBILE_DRAWER_SETTLE_PX ? direction : "tracking";
};
