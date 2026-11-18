type ScaleInput = {
  windowWidth: number;
  windowHeight: number;
  viewportWidth: number;
  desktopPointer: boolean;
  windowSizeFollowsZoom: boolean;
};

const REFERENCE_WINDOW = { width: 1280, height: 780 };

const DESKTOP_LAYOUT_MIN_WIDTH = 1024;

const MAX_SCALE = 3;

export function getInterfaceScale(input: ScaleInput) {
  if (!input.desktopPointer || input.windowSizeFollowsZoom) return 1;

  const scale = Math.min(
    input.windowWidth / REFERENCE_WINDOW.width,
    input.windowHeight / REFERENCE_WINDOW.height,
    input.viewportWidth / DESKTOP_LAYOUT_MIN_WIDTH,
    MAX_SCALE,
  );

  return Math.max(1, scale);
}

const readInterfaceScale = () =>
  getInterfaceScale({
    windowWidth: window.outerWidth,
    windowHeight: window.outerHeight,
    viewportWidth: window.innerWidth,
    desktopPointer: window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    windowSizeFollowsZoom: /firefox\//i.test(navigator.userAgent),
  });

export function startInterfaceScale() {
  const root = document.documentElement;
  let resolution: MediaQueryList | null = null;

  const apply = () => {
    root.style.setProperty("--ui-scale", String(readInterfaceScale()));
    resolution?.removeEventListener("change", apply);
    resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    resolution.addEventListener("change", apply);
  };

  apply();
  window.addEventListener("resize", apply);
}
