import { describe, expect, it } from "vitest";
import {
  decideDrawerSwipe,
  getDrawerSwipeDirection,
  shouldStartDrawerSwipe,
  isDrawerSwipeOptOut,
  isDrawerSwipeScrollOptOut,
} from "@/features/workspace/drawerSwipe";

describe("drawer swipe recognizer", () => {
  it("accepts a primary finger contact regardless of its reported size", () => {
    expect(
      shouldStartDrawerSwipe(
        {
          clientX: 20,
          clientY: 100,
          isPrimary: true,
          pointerType: "touch",
          width: 18,
          height: 18,
        },
        390,
      ),
    ).toBe(true);
    expect(
      shouldStartDrawerSwipe(
        {
          clientX: 20,
          clientY: 100,
          isPrimary: false,
          pointerType: "touch",
          width: 18,
          height: 18,
        },
        390,
      ),
    ).toBe(false);
  });

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

  it("starts a closing swipe from anywhere while the drawer is open", () => {
    expect(
      getDrawerSwipeDirection(
        { clientX: 389, clientY: 100, isPrimary: true, pointerType: "touch" },
        390,
        true,
      ),
    ).toBe("close");
    expect(
      getDrawerSwipeDirection(
        { clientX: 389, clientY: 100, isPrimary: true, pointerType: "touch" },
        390,
        false,
      ),
    ).toBeNull();
    expect(
      getDrawerSwipeDirection(
        { clientX: 389, clientY: 100, isPrimary: true, pointerType: "mouse" },
        390,
        true,
      ),
    ).toBeNull();
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
    expect(decideDrawerSwipe(start, { clientX: 20, clientY: 150 }, "open")).toBe("ignore");
    expect(decideDrawerSwipe(start, { clientX: 0, clientY: 100 }, "open")).toBe("ignore");
    expect(decideDrawerSwipe(start, { clientX: 40, clientY: 100 }, "open")).toBe("tracking");
    expect(decideDrawerSwipe(start, { clientX: 74, clientY: 100 }, "open")).toBe("open");
    expect(
      decideDrawerSwipe({ clientX: 48, clientY: 100 }, { clientX: 112, clientY: 165 }, "open"),
    ).toBe("ignore");
    expect(
      decideDrawerSwipe({ clientX: 48, clientY: 100 }, { clientX: 112, clientY: 140 }, "open"),
    ).toBe("open");
  });

  it("settles a closing swipe to the left and rejects reverse or vertical movement", () => {
    const start = { clientX: 300, clientY: 100 };
    expect(decideDrawerSwipe(start, { clientX: 280, clientY: 100 }, "close")).toBe("tracking");
    expect(decideDrawerSwipe(start, { clientX: 236, clientY: 100 }, "close")).toBe("close");
    expect(decideDrawerSwipe(start, { clientX: 320, clientY: 100 }, "close")).toBe("ignore");
    expect(decideDrawerSwipe(start, { clientX: 236, clientY: 150 }, "close")).toBe("ignore");
  });
});
