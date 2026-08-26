import type { CobaltLocalProcessingPlan } from "./cobaltDownloadSchemas";

/** FFmpeg argument construction for Tagium Save's browser-side processing. */

export const VIDEO_PROGRESS_FILENAME = "tagium-video-progress.txt";

const metadataKeys = new Set([
  "album",
  "composer",
  "genre",
  "copyright",
  "title",
  "artist",
  "album_artist",
  "track",
  "date",
  "sublanguage",
]);

const stripMetadataControlCharacters = (value: string) =>
  Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("");

export const makeMetadataFfmpegArgs = (
  metadata: Record<string, string | undefined> | undefined,
) => {
  if (!metadata) return [];

  return Object.entries(metadata).flatMap(([name, value]) => {
    if (!metadataKeys.has(name) || !value) return [];

    const sanitized = stripMetadataControlCharacters(value);
    if (!sanitized) return [];
    if (name === "sublanguage") {
      return ["-metadata:s:s:0", `language=${sanitized}`];
    }
    return ["-metadata", `${name}=${sanitized}`];
  });
};

export const outputFormatFromFilename = (filename: string) => {
  const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  if (!extension || extension === filename.toLowerCase()) {
    throw new Error("cobalt local processing response is missing an output format.");
  }
  if (!/^[a-z0-9]{1,12}$/.test(extension)) {
    throw new Error("cobalt local processing response has an invalid output format.");
  }
  return extension;
};

const mediaInputCount = (plan: CobaltLocalProcessingPlan, inputNames: readonly string[]) =>
  plan.output.subtitles ? inputNames.length - 1 : inputNames.length;

const appendVideoOutputFlags = (args: string[], format: string) => {
  args.push("-c:v", "copy");
  if (format === "mp4") {
    args.push("-movflags", "faststart+frag_keyframe+empty_moov");
  }
};

const appendMappedVideoAndAudio = (
  args: string[],
  plan: CobaltLocalProcessingPlan,
  inputNames: readonly string[],
) => {
  const mediaCount = mediaInputCount(plan, inputNames);
  if (mediaCount === 2) {
    args.push("-map", "0:v:0", "-map", "1:a:0");
    return;
  }
  if (mediaCount === 1) {
    args.push("-map", "0:v:0", "-map", "0:a:0");
    return;
  }
  throw new Error("cobalt local processing response has an unexpected media tunnel count.");
};

const appendSubtitleFlags = (
  args: string[],
  plan: CobaltLocalProcessingPlan,
  inputNames: readonly string[],
  format: string,
) => {
  if (!plan.output.subtitles) return;
  const subtitleInputIndex = mediaInputCount(plan, inputNames);
  if (subtitleInputIndex < 0 || !inputNames[subtitleInputIndex]) {
    throw new Error("cobalt local processing response is missing its subtitle tunnel.");
  }

  args.push("-map", `${subtitleInputIndex}:s:0`, "-c:s", format === "mp4" ? "mov_text" : "webvtt");
};

const appendAudioFlags = (
  args: string[],
  plan: CobaltLocalProcessingPlan,
  inputNames: readonly string[],
) => {
  const audio = plan.audio;
  if (!audio) {
    throw new Error("cobalt local processing response is missing audio settings.");
  }

  if (audio.cover && audio.format === "mp3" && inputNames.length > 1) {
    args.push("-map", "0", "-map", "1");
    if (audio.cropCover) {
      args.push("-c:v", "mjpeg", "-vf", "scale=-1:720,crop=720:720");
    } else {
      args.push("-c:v", "copy");
    }
  } else {
    args.push("-vn");
  }
  if (audio.copy) {
    args.push("-c:a", "copy");
  } else {
    args.push("-b:a", `${audio.bitrate}k`);
  }

  if (audio.format === "mp3" && audio.bitrate === "8") {
    args.push("-ar", "12000");
  }
  if (audio.format === "opus") {
    args.push("-vbr", "off");
  }

  // The output format is appended once, after all stream and metadata flags.
  // m4a uses ffmpeg's ipod muxer while the rest use their filename format.
};

/**
 * Builds the small, copy-oriented ffmpeg command required by each Cobalt
 * local-processing type. Input names are supplied by the worker so tests and
 * callers can inspect the command without coupling to LibAV's filesystem.
 */
export const makeLocalProcessingFfmpegArgs = (
  plan: CobaltLocalProcessingPlan,
  inputNames: readonly string[],
  outputName: string,
  progressName = VIDEO_PROGRESS_FILENAME,
) => {
  if (inputNames.length === 0) {
    throw new Error("cobalt local processing response has no media tunnels.");
  }

  const format = outputFormatFromFilename(plan.output.filename);
  const args = [
    "-nostdin",
    "-y",
    "-loglevel",
    "error",
    "-progress",
    progressName,
    ...inputNames.flatMap((name) => ["-i", name]),
  ];

  switch (plan.type) {
    case "merge":
    case "remux":
      appendMappedVideoAndAudio(args, plan, inputNames);
      appendVideoOutputFlags(args, format);
      args.push("-c:a", "copy");
      appendSubtitleFlags(args, plan, inputNames, format);
      args.push(...makeMetadataFfmpegArgs(plan.output.metadata));
      break;
    case "mute":
      args.push("-map", "0:v:0");
      appendVideoOutputFlags(args, format);
      args.push("-an");
      appendSubtitleFlags(args, plan, inputNames, format);
      args.push(...makeMetadataFfmpegArgs(plan.output.metadata));
      break;
    case "proxy":
      args.push("-map", "0");
      args.push("-c", "copy");
      appendSubtitleFlags(args, plan, inputNames, format);
      args.push(...makeMetadataFfmpegArgs(plan.output.metadata));
      break;
    case "audio":
      appendAudioFlags(args, plan, inputNames);
      args.push(...makeMetadataFfmpegArgs(plan.output.metadata));
      break;
    case "gif":
      args.push(
        "-vf",
        "scale=-1:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
        "-loop",
        "0",
      );
      break;
  }

  const outputContainer =
    plan.type === "gif"
      ? "gif"
      : plan.type === "audio" && format === "m4a"
        ? "ipod"
        : format === "mkv"
          ? "matroska"
          : format;
  args.push("-f", outputContainer);
  args.push(outputName);
  return args;
};
