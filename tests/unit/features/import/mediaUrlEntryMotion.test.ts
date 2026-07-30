import { describe, expect, it } from "vite-plus/test";
import { getMediaUrlEntryMotionKeyframes } from "@/features/import/mediaUrlEntryMotion";

describe("media URL entry motion", () => {
  it("animates position and real width without scaling the form", () => {
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
