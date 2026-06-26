import type { AudioDownloadBitrate } from "./cobaltDownload";
import type { AppSettings } from "./types";

export const AUDIO_BITRATE_OPTIONS: AudioDownloadBitrate[] = ["320", "256", "128", "96", "64"];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  syncTrackNumbers: true,
  syncFilenames: true,
  audioBitrate: "320",
};
