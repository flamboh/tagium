export type SwipePoint = { clientX: number; clientY: number; pointerType?: string };

export const MOBILE_DRAWER_EDGE_PX = 48;
export const MOBILE_DRAWER_SETTLE_PX = 64;

export type SwipeDecision = "open" | "ignore" | "tracking";

export const shouldStartDrawerSwipe = (
  point: SwipePoint,
  viewportWidth: number,
  target?: EventTarget | null,
) => {
  if (point.pointerType === "mouse" || point.pointerType === "pen") return false;
  if (point.clientX > MOBILE_DRAWER_EDGE_PX || point.clientX < 0 || point.clientY < 0) return false;
  if (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    target.closest("[data-drawer-swipe-optout], input, textarea")
  ) {
    return false;
  }
  return viewportWidth > 0;
};

export const decideDrawerSwipe = (start: SwipePoint, current: SwipePoint): SwipeDecision => {
  const dx = current.clientX - start.clientX;
  const dy = Math.abs(current.clientY - start.clientY);
  if (Math.abs(dx) < 8 && dy < 8) return "tracking";
  if (dx <= 0 || dy > Math.abs(dx)) return "ignore";
  return dx >= MOBILE_DRAWER_SETTLE_PX ? "open" : "tracking";
};
