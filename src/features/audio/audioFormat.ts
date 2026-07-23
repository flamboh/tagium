import type { AudioFormat } from "@/features/audio/metadataEngine/types";
import type { TagiumFile } from "@/features/library/types";

export const MP3_FORMAT = {
  kind: "mp3",
  extension: "mp3",
  mime: "audio/mpeg",
} as const satisfies AudioFormat;

export const getAudioFormat = (file: Pick<TagiumFile, "format">): AudioFormat =>
  file.format ?? MP3_FORMAT;

export const audioFilename = (base: string, format: AudioFormat) =>
  `${base || "track"}.${format.extension}`;

export const replaceAudioExtension = (filename: string, format: AudioFormat) => {
  const base = filename.replace(/\.[^.]+$/u, "") || "track";
  return audioFilename(base, format);
};

export const audioFilenameBase = (filename: string) =>
  filename.replace(/\.(?:mp3|flac|m4a|mp4)$/iu, "") || "track";
