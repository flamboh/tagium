import {
  cobaltAudioFormats,
  cobaltDownloadModes,
  type CobaltVideoCodec,
  type CobaltVideoContainer,
  type CobaltVideoDownloadRequest,
  type CobaltVideoQuality,
  type VideoDownloadPhase,
} from "./download";
import {
  getSystemFailurePresentation,
  type SystemFailurePresentation,
} from "@/shared/systemFailure";

export type VideoDownloadSettings = {
  mode: (typeof cobaltDownloadModes)[number];
  quality: Extract<CobaltVideoQuality, "1080" | "720" | "480">;
  container: Extract<CobaltVideoContainer, "mp4" | "webm" | "mkv">;
  codec: CobaltVideoCodec;
  audioFormat: Extract<(typeof cobaltAudioFormats)[number], "best" | "mp3" | "opus">;
};

export type VideoDownloadSettingsUpdate = {
  [Key in keyof VideoDownloadSettings]: {
    key: Key;
    value: VideoDownloadSettings[Key];
  };
}[keyof VideoDownloadSettings];

export const updateVideoDownloadSettings = (
  settings: VideoDownloadSettings,
  update: VideoDownloadSettingsUpdate,
): VideoDownloadSettings => {
  switch (update.key) {
    case "mode":
      return { ...settings, mode: update.value };
    case "quality":
      return { ...settings, quality: update.value };
    case "audioFormat":
      return { ...settings, audioFormat: update.value };
    case "container":
      return {
        ...settings,
        container: update.value,
        codec:
          update.value === "mp4"
            ? "h264"
            : update.value === "webm" && settings.codec === "h264"
              ? "vp9"
              : settings.codec,
      };
    case "codec":
      return {
        ...settings,
        codec: update.value,
        container: settings.container === "mkv" ? "mkv" : update.value === "h264" ? "mp4" : "webm",
      };
  }
};

const phaseLabels = {
  planning: "preparing",
  "waiting-for-tunnel": "waiting",
  downloading: "downloading",
  processing: "processing",
  finalizing: "finalizing",
} as const satisfies Record<VideoDownloadPhase, string>;

export const getVideoDownloadPhaseLabel = (phase: VideoDownloadPhase) => phaseLabels[phase];

export const getDownloadReadyAnnouncement = (filename: string) => `download ready: ${filename}`;

export const presentVideoDownloadFailure = (error: Error): SystemFailurePresentation =>
  getSystemFailurePresentation(error, "download");

export const buildVideoDownloadRequest = (
  sourceUrl: string,
  settings: VideoDownloadSettings,
): CobaltVideoDownloadRequest => ({
  sourceUrl,
  downloadMode: settings.mode,
  videoQuality: settings.quality,
  youtubeVideoContainer: settings.container,
  youtubeVideoCodec: settings.codec,
  audioFormat: settings.audioFormat,
  filenameStyle: "pretty",
});
