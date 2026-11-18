import { describe, expect, it } from "vite-plus/test";
import { getInterfaceScale } from "@/runtime/interfaceScale";

const desktopWindow = (windowWidth: number, windowHeight: number, zoom = 1) => ({
  windowWidth,
  windowHeight,
  viewportWidth: windowWidth / zoom,
  desktopPointer: true,
  windowSizeFollowsZoom: false,
});

describe("getInterfaceScale", () => {
  it("leaves laptop-sized windows at their normal size", () => {
    expect(getInterfaceScale(desktopWindow(1366, 728))).toBe(1);
    expect(getInterfaceScale(desktopWindow(1280, 720))).toBe(1);
  });

  it("grows with the browser window", () => {
    expect(getInterfaceScale(desktopWindow(1920, 1040))).toBeCloseTo(1.333, 2);
    expect(getInterfaceScale(desktopWindow(2560, 1400))).toBeCloseTo(1.795, 2);
    expect(getInterfaceScale(desktopWindow(3840, 2120))).toBeCloseTo(2.718, 2);
  });

  it("scales by the tighter side of wide or tall windows", () => {
    expect(getInterfaceScale(desktopWindow(3440, 1400))).toBeCloseTo(1.795, 2);
    expect(getInterfaceScale(desktopWindow(1600, 2120))).toBeCloseTo(1.25, 2);
  });

  it("keeps the same scale when the user zooms out, so zoom shrinks the page", () => {
    for (const [width, height] of [
      [1920, 1040],
      [3840, 2120],
    ]) {
      const normal = getInterfaceScale(desktopWindow(width, height));

      for (const zoom of [0.9, 0.75, 0.5, 0.33]) {
        expect(getInterfaceScale(desktopWindow(width, height, zoom))).toBe(normal);
      }
    }
  });

  it("never shrinks the page when the user zooms in", () => {
    for (const [width, height] of [
      [1920, 1040],
      [3840, 2120],
    ]) {
      let previousSize = 0;

      for (const zoom of [1, 1.1, 1.25, 1.5, 1.75, 2, 3, 4, 5]) {
        const size = getInterfaceScale(desktopWindow(width, height, zoom)) * zoom;
        expect(size).toBeGreaterThanOrEqual(previousSize);
        previousSize = size;
      }
    }
  });

  it("keeps room for the desktop layout when zoomed in or squeezed", () => {
    for (const viewportWidth of [3840, 2560, 1800, 1300]) {
      const scale = getInterfaceScale({ ...desktopWindow(3840, 2120), viewportWidth });
      expect(viewportWidth / (16 * scale)).toBeGreaterThanOrEqual(64);
    }
  });

  it("stops at three times the normal size", () => {
    expect(getInterfaceScale(desktopWindow(7680, 4320))).toBe(3);
  });

  it("leaves phones and tablets alone", () => {
    expect(getInterfaceScale({ ...desktopWindow(2560, 1600), desktopPointer: false })).toBe(1);
  });

  it("leaves browsers whose window size changes with zoom alone", () => {
    expect(getInterfaceScale({ ...desktopWindow(3840, 2120), windowSizeFollowsZoom: true })).toBe(
      1,
    );
  });
});
