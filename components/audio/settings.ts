import { z } from "zod";
import type { AudioDownloadBitrate } from "./cobaltDownload";
import type { AppSettings } from "./types";

export const AUDIO_BITRATE_OPTIONS = [
  "320",
  "256",
  "128",
  "96",
  "64",
] as const satisfies readonly AudioDownloadBitrate[];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  syncTrackNumbers: true,
  syncFilenames: true,
  audioBitrate: "320",
};

export const APP_SETTINGS_STORAGE_KEY = "tagium:app-settings";

const storedAppSettingsSchema = z
  .object({
    syncTrackNumbers: z.boolean().catch(DEFAULT_APP_SETTINGS.syncTrackNumbers),
    syncFilenames: z.boolean().catch(DEFAULT_APP_SETTINGS.syncFilenames),
    audioBitrate: z.enum(AUDIO_BITRATE_OPTIONS).catch(DEFAULT_APP_SETTINGS.audioBitrate),
  })
  .catch(DEFAULT_APP_SETTINGS);

export const loadAppSettings = (storage: Pick<Storage, "getItem"> = localStorage): AppSettings => {
  const storedSettings = storage.getItem(APP_SETTINGS_STORAGE_KEY);
  if (storedSettings === null) return DEFAULT_APP_SETTINGS;

  try {
    return {
      ...DEFAULT_APP_SETTINGS,
      ...storedAppSettingsSchema.parse(JSON.parse(storedSettings)),
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
};

export const saveAppSettings = (
  settings: AppSettings,
  storage: Pick<Storage, "setItem"> = localStorage,
) => {
  storage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};
