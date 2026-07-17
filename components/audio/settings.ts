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

export const THEME_OPTIONS = [
  "liner",
  "signal",
  "pressing",
] as const satisfies readonly AppSettings["theme"][];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "signal",
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

const storedAppSettingsSchema = Schema.Struct({
  theme: Schema.Literals(THEME_OPTIONS).pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(DEFAULT_APP_SETTINGS.theme))),
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_APP_SETTINGS.theme)),
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

    return {
      ...DEFAULT_APP_SETTINGS,
      ...decodeStoredAppSettings(JSON.parse(storedSettings)),
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
