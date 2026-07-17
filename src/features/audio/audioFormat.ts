export type AudioFormat = "mp3";

export interface AudioFormatInfo {
  id: AudioFormat;
  extension: ".mp3";
  mimeType: "audio/mpeg";
}

const audioFormatInfo = {
  mp3: {
    id: "mp3",
    extension: ".mp3",
    mimeType: "audio/mpeg",
  },
} as const satisfies Record<AudioFormat, AudioFormatInfo>;

export const getAudioFormatInfo = (format: AudioFormat): AudioFormatInfo => audioFormatInfo[format];

export const getAudioUploadAccept = () =>
  Object.values(audioFormatInfo)
    .flatMap(({ extension, mimeType }) => [extension, mimeType])
    .join(",");

export const hasAudioExtension = (filename: string, format: AudioFormat) =>
  filename.toLowerCase().endsWith(getAudioFormatInfo(format).extension);

export const withoutAudioExtension = (filename: string, format: AudioFormat) => {
  const { extension } = getAudioFormatInfo(format);
  return hasAudioExtension(filename, format) ? filename.slice(0, -extension.length) : filename;
};

export const withAudioExtension = (base: string, format: AudioFormat) =>
  hasAudioExtension(base, format) ? base : `${base}${getAudioFormatInfo(format).extension}`;

export const normalizeAudioFilename = (filename: string, format: AudioFormat) => {
  if (hasAudioExtension(filename, format)) return filename;
  const basename = filename.replace(/\.[^.]+$/, "") || "track";
  return withAudioExtension(basename, format);
};
