import { describe, expect, it } from "vite-plus/test";
import { getAccentForeground, type CssColorResolver } from "./theme";

const resolveHex: CssColorResolver = (color) => {
  const value = color.slice(1);
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
};

describe("accent foreground", () => {
  it("uses white on cobalt", () => {
    expect(getAccentForeground("#114cbf", resolveHex)).toBe("oklch(0.985 0 0)");
  });

  it("uses ink on light yellow", () => {
    expect(getAccentForeground("#f4df61", resolveHex)).toBe("oklch(0.22 0.015 264)");
  });

  it("uses the default foreground for an invalid color", () => {
    expect(getAccentForeground("invalid", () => undefined)).toBe("oklch(0.985 0 0)");
  });

  it("parses hex without canvas when canvas is unavailable", () => {
    expect(
      getAccentForeground("#fff", () => {
        throw new Error("canvas unavailable");
      }),
    ).toBe("oklch(0.22 0.015 264)");
  });
});
