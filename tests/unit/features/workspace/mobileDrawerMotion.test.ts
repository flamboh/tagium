import { describe, expect, it } from "vitest";
import { MOBILE_DRAWER_TRANSITION_CLASSES } from "@/features/library/TagSidebarPanel";

describe("mobile drawer motion", () => {
  it("transitions the CSS translate property used by Tailwind v4", () => {
    expect(MOBILE_DRAWER_TRANSITION_CLASSES).toContain("transition-[translate,");
    expect(MOBILE_DRAWER_TRANSITION_CLASSES).not.toContain("transition-[transform,");
  });
});
