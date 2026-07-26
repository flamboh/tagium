import { describe, expect, it } from "vitest";
import { MOBILE_DRAWER_TRANSITION_CLASSES } from "@/features/library/TagSidebarPanel";

describe("mobile drawer motion", () => {
  it("transitions the CSS translate property used by Tailwind v4", () => {
    expect(MOBILE_DRAWER_TRANSITION_CLASSES).toContain("transition-[translate,");
    expect(MOBILE_DRAWER_TRANSITION_CLASSES).not.toContain("transition-[transform,");
  });

  it("uses the motion timing from the superseded drawer PR", () => {
    expect(MOBILE_DRAWER_TRANSITION_CLASSES).toContain("duration-200");
    expect(MOBILE_DRAWER_TRANSITION_CLASSES).toContain(
      "ease-[cubic-bezier(0.22,1,0.36,1)]",
    );
  });
});
