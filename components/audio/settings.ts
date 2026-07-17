import { Effect, Option, Schema } from "effect";
import type { AudioDownloadBitrate } from "./cobaltAudio";
import type { AppSettings } from "./types";

export const AUDIO_BITRATE_OPTIONS = [
  "320",
  "256",
  "128",
  "96",
  "64",
] as const satisfies readonly AudioDownloadBitrate[];

export const MODE_OPTIONS = ["light", "dark"] as const satisfies readonly AppSettings["mode"][];
export const WORDMARK_FONT_OPTIONS = [
  "archivo-black",
  "krona-one",
  "anton",
  "rajdhani",
] as const satisfies readonly AppSettings["wordmarkFont"][];

export const ACCENT_PRESETS = [
  // Source colors, in order: oklch(0.46 0.19 262), oklch(0.62 0.21 30),
  // oklch(0.45 0.12 155), oklch(0.68 0.16 75), oklch(0.42 0.16 25),
  // oklch(0.60 0.11 200), oklch(0.42 0.14 310), oklch(0.72 0.17 125),
  // oklch(0.32 0.05 264), oklch(0.60 0.21 33).
  { name: "cobalt & coral", accentA: "#114cbf", accentB: "#e93f2d" },
  { name: "forest & marigold", accentA: "#006836", accentB: "#d08600" },
  { name: "oxblood & teal", accentA: "#90101a", accentB: "#00939a" },
  { name: "aubergine & chartreuse", accentA: "#643185", accentB: "#8cb623" },
  { name: "ink & vermilion", accentA: "#26324c", accentB: "#e23915" },
] as const;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  mode: "light",
  accentA: ACCENT_PRESETS[0].accentA,
  accentB: ACCENT_PRESETS[0].accentB,
  darkenAccentsInDarkMode: true,
  wordmarkFont: "archivo-black",
  syncTrackNumbers: true,
  syncFilenames: true,
  audioBitrate: "320",
  applySoundCloudAlbumCoverToTracks: true,
};

export const APP_SETTINGS_STORAGE_KEY = "tagium:app-settings";

const booleanWithDefault = (value: boolean) =>
  Schema.Boolean.pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(value))),
    Schema.withDecodingDefaultKey(Effect.succeed(value)),
  );

const number = String.raw`[-+]?(?:\d*\.)?\d+`;
const alpha = String.raw`${number}%?`;
const rgbChannel = String.raw`${number}%?`;
const rgbColor = new RegExp(
  String.raw`^rgba?\(\s*${rgbChannel}(?:\s*,\s*|\s+)${rgbChannel}(?:\s*,\s*|\s+)${rgbChannel}(?:\s*(?:,|\/)\s*${alpha})?\s*\)$`,
  "i",
);
const oklchColor = new RegExp(
  String.raw`^oklch\(\s*${number}%?\s+${number}\s+${number}(?:deg|grad|rad|turn)?(?:\s*\/\s*${alpha})?\s*\)$`,
  "i",
);

export const isSupportedAccentColor = (color: string) => {
  const value = color.trim();
  return /^#[\da-f]{6}$/i.test(value) || rgbColor.test(value) || oklchColor.test(value);
};

const accentColorWithDefault = (value: string) =>
  Schema.String.pipe(
    Schema.refine((color): color is string => isSupportedAccentColor(color)),
    Schema.catchDecoding(() => Effect.succeed(Option.some(value))),
    Schema.withDecodingDefaultKey(Effect.succeed(value)),
  );

const storedAppSettingsSchema = Schema.Struct({
  mode: Schema.Literals(MODE_OPTIONS).pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(DEFAULT_APP_SETTINGS.mode))),
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_APP_SETTINGS.mode)),
  ),
  accentA: accentColorWithDefault(DEFAULT_APP_SETTINGS.accentA),
  accentB: accentColorWithDefault(DEFAULT_APP_SETTINGS.accentB),
  darkenAccentsInDarkMode: booleanWithDefault(DEFAULT_APP_SETTINGS.darkenAccentsInDarkMode),
  wordmarkFont: Schema.Literals(WORDMARK_FONT_OPTIONS).pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(DEFAULT_APP_SETTINGS.wordmarkFont))),
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_APP_SETTINGS.wordmarkFont)),
  ),
  syncTrackNumbers: booleanWithDefault(DEFAULT_APP_SETTINGS.syncTrackNumbers),
  syncFilenames: booleanWithDefault(DEFAULT_APP_SETTINGS.syncFilenames),
  audioBitrate: Schema.Literals(AUDIO_BITRATE_OPTIONS).pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(DEFAULT_APP_SETTINGS.audioBitrate))),
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_APP_SETTINGS.audioBitrate)),
  ),
  applySoundCloudAlbumCoverToTracks: booleanWithDefault(
    DEFAULT_APP_SETTINGS.applySoundCloudAlbumCoverToTracks,
  ),
});

const decodeStoredAppSettings = Schema.decodeUnknownSync(storedAppSettingsSchema);

export const loadAppSettings = (storage?: Pick<Storage, "getItem">): AppSettings => {
  try {
    const targetStorage = storage ?? localStorage;
    const storedSettings = targetStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (storedSettings === null) return DEFAULT_APP_SETTINGS;

    const parsedSettings: unknown = JSON.parse(storedSettings);
    const decodedSettings = decodeStoredAppSettings(parsedSettings);
    const legacyTheme =
      typeof parsedSettings === "object" && parsedSettings !== null && !("mode" in parsedSettings)
        ? (parsedSettings as { theme?: unknown }).theme
        : undefined;

    return {
      ...DEFAULT_APP_SETTINGS,
      ...decodedSettings,
      mode: legacyTheme === "signal" ? "dark" : decodedSettings.mode,
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
};

export const saveAppSettings = (settings: AppSettings, storage?: Pick<Storage, "setItem">) => {
  try {
    const targetStorage = storage ?? localStorage;
    targetStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
};
