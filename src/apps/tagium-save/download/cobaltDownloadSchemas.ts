import { Schema } from "effect";

/** Cobalt request and response contracts used by Tagium Save. */

export const cobaltAudioBitrates = ["320", "256", "128", "96", "64", "8"] as const;
export const cobaltAudioFormats = ["best", "mp3", "ogg", "wav", "opus"] as const;
export const cobaltDownloadModes = ["auto", "audio", "mute"] as const;
export const cobaltFilenameStyles = ["classic", "pretty", "basic", "nerdy"] as const;
export const cobaltVideoCodecs = ["h264", "av1", "vp9"] as const;
export const cobaltVideoContainers = ["auto", "mp4", "webm", "mkv"] as const;
export const cobaltVideoQualities = ["1080", "720", "480", "360", "240", "144"] as const;

export type CobaltAudioBitrate = (typeof cobaltAudioBitrates)[number];
export type CobaltAudioFormat = (typeof cobaltAudioFormats)[number];
export type CobaltDownloadMode = (typeof cobaltDownloadModes)[number];
export type CobaltFilenameStyle = (typeof cobaltFilenameStyles)[number];
export type CobaltVideoCodec = (typeof cobaltVideoCodecs)[number];
export type CobaltVideoContainer = (typeof cobaltVideoContainers)[number];
export type CobaltVideoQuality = (typeof cobaltVideoQualities)[number];

export interface CobaltVideoDownloadRequest {
  sourceUrl: string;
  signal?: AbortSignal;
  /**
   * These two options are fixed by this browser client. They remain accepted
   * on the request shape so a caller can pass a complete Cobalt option object,
   * while request-body construction always enforces the safe values below.
   */
  localProcessing?: "forced";
  alwaysProxy?: true;
  audioBitrate?: CobaltAudioBitrate;
  audioFormat?: CobaltAudioFormat;
  downloadMode?: CobaltDownloadMode;
  filenameStyle?: CobaltFilenameStyle;
  youtubeVideoCodec?: CobaltVideoCodec;
  youtubeVideoContainer?: CobaltVideoContainer;
  videoQuality?: CobaltVideoQuality;
  youtubeDubLang?: string;
  subtitleLang?: string;
  disableMetadata?: boolean;
  allowH265?: boolean;
  convertGif?: boolean;
  tiktokFullAudio?: boolean;
  youtubeBetterAudio?: boolean;
  importId?: string;
  trackIndex?: number;
}

export type CobaltVideoDownloadRequestBody = {
  url: string;
  audioBitrate: CobaltAudioBitrate;
  audioFormat: CobaltAudioFormat;
  downloadMode: CobaltDownloadMode;
  filenameStyle: CobaltFilenameStyle;
  youtubeVideoCodec: CobaltVideoCodec;
  youtubeVideoContainer: CobaltVideoContainer;
  videoQuality: CobaltVideoQuality;
  localProcessing: "forced";
  alwaysProxy: true;
  youtubeDubLang?: string;
  subtitleLang?: string;
  disableMetadata?: boolean;
  allowH265?: boolean;
  convertGif?: boolean;
  tiktokFullAudio?: boolean;
  youtubeBetterAudio?: boolean;
};

export const makeCobaltVideoDownloadRequestBody = (
  request: CobaltVideoDownloadRequest,
): CobaltVideoDownloadRequestBody => {
  const body: CobaltVideoDownloadRequestBody = {
    url: request.sourceUrl,
    audioBitrate: request.audioBitrate ?? "128",
    audioFormat: request.audioFormat ?? "best",
    downloadMode: request.downloadMode ?? "auto",
    filenameStyle: request.filenameStyle ?? "pretty",
    youtubeVideoCodec: request.youtubeVideoCodec ?? "h264",
    youtubeVideoContainer: request.youtubeVideoContainer ?? "auto",
    videoQuality: request.videoQuality ?? "1080",
    localProcessing: "forced",
    alwaysProxy: true,
  };

  if (request.youtubeDubLang !== undefined) body.youtubeDubLang = request.youtubeDubLang;
  if (request.subtitleLang !== undefined) body.subtitleLang = request.subtitleLang;
  if (request.disableMetadata !== undefined) body.disableMetadata = request.disableMetadata;
  if (request.allowH265 !== undefined) body.allowH265 = request.allowH265;
  if (request.convertGif !== undefined) body.convertGif = request.convertGif;
  if (request.tiktokFullAudio !== undefined) body.tiktokFullAudio = request.tiktokFullAudio;
  if (request.youtubeBetterAudio !== undefined) {
    body.youtubeBetterAudio = request.youtubeBetterAudio;
  }

  return body;
};

const cobaltOutputMetadataSchema = Schema.Record(Schema.String, Schema.UndefinedOr(Schema.String));

const cobaltTunnelDownloadPlanSchema = Schema.Struct({
  status: Schema.Literal("tunnel"),
  url: Schema.String,
  filename: Schema.String,
});

const cobaltRedirectDownloadPlanSchema = Schema.Struct({
  status: Schema.Literal("redirect"),
  url: Schema.String,
  filename: Schema.String,
});

const cobaltPickerItemSchema = Schema.Struct({
  type: Schema.Literals(["photo", "video", "gif"]),
  url: Schema.String,
  thumb: Schema.optionalKey(Schema.String),
});

const cobaltPickerDownloadPlanSchema = Schema.Struct({
  status: Schema.Literal("picker"),
  picker: Schema.Array(cobaltPickerItemSchema),
  audio: Schema.optionalKey(Schema.String),
  audioFilename: Schema.optionalKey(Schema.String),
});

const cobaltLocalProcessingPlanSchema = Schema.Struct({
  status: Schema.Literal("local-processing"),
  type: Schema.Literals(["merge", "mute", "audio", "gif", "remux", "proxy"]),
  service: Schema.optionalKey(Schema.String),
  tunnel: Schema.Array(Schema.String),
  output: Schema.Struct({
    type: Schema.String,
    filename: Schema.String,
    metadata: Schema.optionalKey(cobaltOutputMetadataSchema),
    subtitles: Schema.optionalKey(Schema.Boolean),
  }),
  audio: Schema.optionalKey(
    Schema.Struct({
      copy: Schema.Boolean,
      format: Schema.String,
      bitrate: Schema.String,
      cover: Schema.optionalKey(Schema.Boolean),
      cropCover: Schema.optionalKey(Schema.Boolean),
    }),
  ),
  isHLS: Schema.optionalKey(Schema.Boolean),
});

const cobaltErrorPlanSchema = Schema.Struct({
  status: Schema.Literal("error"),
  error: Schema.Struct({
    code: Schema.String,
    context: Schema.optionalKey(Schema.Unknown),
  }),
});

export const cobaltDownloadPlanSchema = Schema.Union([
  cobaltTunnelDownloadPlanSchema,
  cobaltRedirectDownloadPlanSchema,
  cobaltPickerDownloadPlanSchema,
  cobaltLocalProcessingPlanSchema,
]);

export const cobaltDownloadResponseSchema = Schema.Union([
  cobaltErrorPlanSchema,
  cobaltTunnelDownloadPlanSchema,
  cobaltRedirectDownloadPlanSchema,
  cobaltPickerDownloadPlanSchema,
  cobaltLocalProcessingPlanSchema,
]);

export type CobaltPickerItem = Schema.Schema.Type<typeof cobaltPickerItemSchema>;
export type CobaltPickerPlan = Schema.Schema.Type<typeof cobaltPickerDownloadPlanSchema>;
export type CobaltTunnelPlan = Schema.Schema.Type<typeof cobaltTunnelDownloadPlanSchema>;
export type CobaltRedirectPlan = Schema.Schema.Type<typeof cobaltRedirectDownloadPlanSchema>;
export type CobaltLocalProcessingPlan = Schema.Schema.Type<typeof cobaltLocalProcessingPlanSchema>;
export type CobaltDownloadPlan = Schema.Schema.Type<typeof cobaltDownloadPlanSchema>;
export type CobaltDownloadResponse = Schema.Schema.Type<typeof cobaltDownloadResponseSchema>;

export const decodeCobaltDownloadPlanEffect = Schema.decodeUnknownEffect(cobaltDownloadPlanSchema);
export const decodeCobaltDownloadResponseEffect = Schema.decodeUnknownEffect(
  cobaltDownloadResponseSchema,
);
