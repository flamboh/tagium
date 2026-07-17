import type { AppSettings } from "./types";

type Rgb = readonly [number, number, number];
export type CssColorResolver = (color: string) => Rgb;
type OptionalCssColorResolver = (color: string) => Rgb | undefined;

const foregrounds = {
  white: { css: "oklch(0.985 0 0)", rgb: [250, 250, 250] as const },
  ink: { css: "oklch(0.22 0.015 264)", rgb: [23, 27, 34] as const },
};
const fallbackRgb: Rgb = [17, 76, 191];

export const cssColorToHex = (color: string) =>
  `#${resolveCssColor(color)
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;

const parseHexColor = (color: string): Rgb | undefined => {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
  if (!match) return undefined;
  const value = match[1].length === 3 ? match[1].replace(/./g, "$&$&") : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
};

const resolveCanvasColor: OptionalCssColorResolver = (color) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  context.fillStyle = "#000";
  context.fillStyle = color;
  const firstResult = context.fillStyle;
  context.fillStyle = "#fff";
  context.fillStyle = color;
  if (context.fillStyle !== firstResult) return undefined;
  context.clearRect(0, 0, 1, 1);
  context.fillRect(0, 0, 1, 1);
  return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3)) as unknown as Rgb;
};

export const resolveCssColor = (
  color: string,
  resolveNonHex: OptionalCssColorResolver = resolveCanvasColor,
): Rgb => {
  const hex = parseHexColor(color);
  if (hex) return hex;
  try {
    return resolveNonHex(color) ?? fallbackRgb;
  } catch {
    return fallbackRgb;
  }
};

const luminance = (rgb: Rgb) =>
  rgb
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);

const contrast = (first: Rgb, second: Rgb) => {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};

export const getAccentForeground = (accent: string, resolve?: OptionalCssColorResolver) => {
  const rgb = resolveCssColor(accent, resolve);
  return contrast(rgb, foregrounds.white.rgb) >= contrast(rgb, foregrounds.ink.rgb)
    ? foregrounds.white.css
    : foregrounds.ink.css;
};

export const WORDMARK_FONT_STYLES: Record<
  AppSettings["wordmarkFont"],
  { family: string; tracking: string; scale: string }
> = {
  "archivo-black": { family: '"Archivo Black"', tracking: "-0.02em", scale: "1" },
  "krona-one": { family: '"Krona One"', tracking: "-0.01em", scale: "0.82" },
  anton: { family: '"Anton"', tracking: "0.01em", scale: "1.06" },
  rajdhani: { family: '"Rajdhani"', tracking: "0", scale: "1.12" },
};
