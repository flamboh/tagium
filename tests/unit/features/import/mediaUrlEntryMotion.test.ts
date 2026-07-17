import { describe, expect, it } from "vite-plus/test";
import { getMediaUrlEntryMotionKeyframes } from "@/features/import/mediaUrlEntryMotion";
import { getMediaUrlEntryPresentation } from "@/features/import/mediaUrlEntryPresentation";

describe("media URL entry presentation", () => {
  it("docks the persistent entry in empty-library settings", () => {
    expect(getMediaUrlEntryPresentation(true, false)).toEqual({
      layout: "landing",
      hidden: false,
      docked: false,
    });
    expect(getMediaUrlEntryPresentation(true, true)).toEqual({
      layout: "editor",
      hidden: false,
      docked: true,
    });
  });

  it("preserves non-empty-library visibility behavior", () => {
    expect(getMediaUrlEntryPresentation(false, false)).toEqual({
      layout: "editor",
      hidden: false,
      docked: false,
    });
    expect(getMediaUrlEntryPresentation(false, true)).toEqual({
      layout: "editor",
      hidden: true,
      docked: false,
    });
  });

  it("animates position and real width without a transform", () => {
    const keyframes = getMediaUrlEntryMotionKeyframes(
      { left: 100, top: 500, width: 448 },
      { left: 300, top: 700, width: 768 },
    );

    expect(keyframes).toEqual([
      { left: "100px", top: "500px", width: "448px" },
      { left: "300px", top: "700px", width: "768px" },
    ]);
    expect(keyframes.every((keyframe) => keyframe.transform === undefined)).toBe(true);
  });
});
