import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  decideDrawerSwipe,
  isDrawerSwipeInteractiveTarget,
} from "@/features/workspace/drawerSwipe";

afterEach(() => vi.unstubAllGlobals());

describe("drawer swipe decision", () => {
  it("commits deliberate opening and closing swipes", () => {
    expect(
      decideDrawerSwipe(
        [
          { x: 24, y: 100, time: 0 },
          { x: 92, y: 104, time: 120 },
        ],
        "open",
      ),
    ).toBe("commit");
    expect(
      decideDrawerSwipe(
        [
          { x: 340, y: 100, time: 0 },
          { x: 272, y: 104, time: 120 },
        ],
        "close",
      ),
    ).toBe("commit");
  });

  it("rejects vertical, short, wrong-direction, and reversed short flicks", () => {
    expect(
      decideDrawerSwipe(
        [
          { x: 24, y: 100, time: 0 },
          { x: 96, y: 150, time: 100 },
        ],
        "open",
      ),
    ).toBe("reject");
    expect(
      decideDrawerSwipe(
        [
          { x: 24, y: 100, time: 0 },
          { x: 50, y: 100, time: 100 },
        ],
        "open",
      ),
    ).toBe("reject");
    expect(
      decideDrawerSwipe(
        [
          { x: 96, y: 100, time: 0 },
          { x: 24, y: 100, time: 100 },
        ],
        "open",
      ),
    ).toBe("reject");
    expect(
      decideDrawerSwipe(
        [
          { x: 24, y: 100, time: 0 },
          { x: 70, y: 100, time: 30 },
          { x: 60, y: 100, time: 40 },
          { x: 60, y: 100, time: 50 },
        ],
        "open",
      ),
    ).toBe("reject");
  });

  it("allows a committed long swipe to end with small release jitter", () => {
    expect(
      decideDrawerSwipe(
        [
          { x: 24, y: 100, time: 0 },
          { x: 100, y: 100, time: 80 },
          { x: 96, y: 100, time: 100 },
        ],
        "open",
      ),
    ).toBe("commit");
  });

  it("accepts a direction-signed fast short flick", () => {
    expect(
      decideDrawerSwipe(
        [
          { x: 24, y: 100, time: 0 },
          { x: 58, y: 100, time: 40 },
        ],
        "open",
      ),
    ).toBe("commit");
  });

  it("excludes interactive start targets while allowing background surfaces", () => {
    class FakeElement {
      constructor(private readonly interactive: boolean) {}

      closest() {
        return this.interactive ? this : null;
      }
    }
    vi.stubGlobal("Element", FakeElement);
    expect(isDrawerSwipeInteractiveTarget(new FakeElement(true) as never)).toBeTruthy();
    expect(isDrawerSwipeInteractiveTarget(new FakeElement(false) as never)).toBeNull();
  });
});
