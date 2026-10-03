import { describe, expect, it } from "vite-plus/test";
import {
  extractPeaks,
  formatTimestamp,
  getPointerTime,
  moveClipEdge,
  normalizeClip,
  resamplePeaks,
} from "@/features/editor/waveform";

const decoded = (channels: number[][]) => ({
  duration: 1,
  length: channels[0]?.length ?? 0,
  numberOfChannels: channels.length,
  getChannelData: (index: number) => Float32Array.from(channels[index] ?? []),
});

describe("waveform", () => {
  it("formats timestamps with hours only when needed", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65.9)).toBe("1:05");
    expect(formatTimestamp(3725)).toBe("1:02:05");
    expect(formatTimestamp(Number.NaN)).toBe("0:00");
  });

  it("maps pointer positions onto the track and clamps outside the surface", () => {
    expect(getPointerTime(150, 100, 200, 60)).toBe(15);
    expect(getPointerTime(50, 100, 200, 60)).toBe(0);
    expect(getPointerTime(400, 100, 200, 60)).toBe(60);
    expect(getPointerTime(150, 100, 0, 60)).toBe(0);
  });

  it("drops clips that cover the whole track and clamps the rest", () => {
    expect(normalizeClip({ start: 0, end: 60 }, 60)).toBeUndefined();
    expect(normalizeClip({ start: 0.01, end: 59.99 }, 60)).toBeUndefined();
    expect(normalizeClip({ start: -5, end: 30 }, 60)).toEqual({ start: 0, end: 30 });
    expect(normalizeClip({ start: 10, end: 90 }, 60)).toEqual({ start: 10, end: 60 });
    expect(normalizeClip({ start: 10, end: 20 }, 0)).toBeUndefined();
  });

  it("keeps clip edges at least a second apart", () => {
    const clip = { start: 10, end: 20 };
    expect(moveClipEdge(clip, "start", 25, 60)).toEqual({ start: 19, end: 20 });
    expect(moveClipEdge(clip, "end", 5, 60)).toEqual({ start: 10, end: 11 });
    expect(moveClipEdge(clip, "start", -3, 60)).toEqual({ start: 0, end: 20 });
    expect(moveClipEdge(clip, "end", 99, 60)).toEqual({ start: 10, end: 60 });
  });

  it("extracts normalized peaks across channels", () => {
    const peaks = extractPeaks(
      decoded([
        [0.1, -0.2, 0, 0],
        [0, 0, 0.4, -0.1],
      ]),
      2,
    );
    expect(peaks).toEqual([0.5, 1]);
  });

  it("resamples peaks to the rendered bar count by keeping each bucket's maximum", () => {
    expect(resamplePeaks([0.1, 0.9, 0.3, 0.2], 2)).toEqual([0.9, 0.3]);
    expect(resamplePeaks([0.5], 3)).toEqual([0.5, 0.5, 0.5]);
    expect(resamplePeaks([], 2)).toEqual([0, 0]);
  });
});
