import { describe, expect, it } from "vitest";
import {
  decideDrawerSwipe,
  shouldStartDrawerSwipe,
  isDrawerSwipeOptOut,
  isDrawerSwipeScrollOptOut,
} from "@/features/workspace/drawerSwipe";

describe("drawer swipe recognizer", () => {
  it("starts from the left 40% for touch input", () => {
    expect(shouldStartDrawerSwipe({ clientX: 20, clientY: 100, pointerType: "touch" }, 390)).toBe(
      true,
    );
    expect(shouldStartDrawerSwipe({ clientX: 200, clientY: 100, pointerType: "touch" }, 390)).toBe(
      false,
    );
    expect(shouldStartDrawerSwipe({ clientX: 20, clientY: 100, pointerType: "mouse" }, 390)).toBe(
      false,
    );
  });

  it("allows a deliberate swipe beginning on ordinary buttons and links", () => {
    expect(isDrawerSwipeOptOut("button")).toBe(false);
    expect(isDrawerSwipeOptOut("a")).toBe(false);
    expect(shouldStartDrawerSwipe({ clientX: 20, clientY: 100, pointerType: "touch" }, 390)).toBe(
      true,
    );
  });

  it("keeps protected controls opted out", () => {
    expect(isDrawerSwipeOptOut("input")).toBe(true);
    expect(isDrawerSwipeOptOut("textarea")).toBe(true);
    expect(isDrawerSwipeOptOut("select")).toBe(true);
    expect(isDrawerSwipeOptOut("contenteditable")).toBe(true);
    expect(isDrawerSwipeOptOut("data-drawer-swipe-optout")).toBe(true);
  });

  it("keeps genuinely horizontally scrollable ancestors opted out", () => {
    expect(isDrawerSwipeScrollOptOut("auto", 400, 300)).toBe(true);
    expect(isDrawerSwipeScrollOptOut("scroll", 400, 400)).toBe(false);
    expect(isDrawerSwipeScrollOptOut("hidden", 400, 300)).toBe(false);
  });

  it("rejects vertical and reverse movement and settles after 64px", () => {
    const start = { clientX: 10, clientY: 100 };
    expect(decideDrawerSwipe(start, { clientX: 20, clientY: 150 })).toBe("ignore");
    expect(decideDrawerSwipe(start, { clientX: 0, clientY: 100 })).toBe("ignore");
    expect(decideDrawerSwipe(start, { clientX: 40, clientY: 100 })).toBe("tracking");
    expect(decideDrawerSwipe(start, { clientX: 74, clientY: 100 })).toBe("open");
    expect(decideDrawerSwipe({ clientX: 48, clientY: 100 }, { clientX: 112, clientY: 165 })).toBe(
      "ignore",
    );
    expect(decideDrawerSwipe({ clientX: 48, clientY: 100 }, { clientX: 112, clientY: 140 })).toBe(
      "open",
    );
  });
});
