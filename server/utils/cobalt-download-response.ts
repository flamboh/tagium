import { Effect, Schema } from "effect";
import { signCobaltMachine, signCobaltResource } from "./cobalt-machine-affinity";
import { urlStringSchema } from "./schema";

const httpUrlSchema = urlStringSchema.check(
  Schema.makeFilter((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:" || "Expected an HTTP(S) URL";
  }),
);

const COBALT_RESOURCE_CAPABILITY_TTL_SECONDS = 15 * 60;

const cobaltLanguageSchema = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      /^[0-9a-zA-Z-]{2,8}$/.test(value) ||
      "Expected a language code containing 2 to 8 letters, numbers, or hyphens",
  ),
);

/**
 * The public download surface mirrors Cobalt's useful request options while keeping
 * proxying and processing policy under Tagium's control.
 */
export const cobaltDownloadRequestSchema = Schema.Struct({
  url: httpUrlSchema,
  audioBitrate: Schema.optionalKey(Schema.Literals(["320", "256", "128", "96", "64", "8"])),
  audioFormat: Schema.optionalKey(Schema.Literals(["best", "mp3", "ogg", "wav", "opus"])),
  downloadMode: Schema.optionalKey(Schema.Literals(["auto", "audio", "mute"])),
  filenameStyle: Schema.optionalKey(Schema.Literals(["classic", "pretty", "basic", "nerdy"])),
  youtubeVideoCodec: Schema.optionalKey(Schema.Literals(["h264", "av1", "vp9"])),
  youtubeVideoContainer: Schema.optionalKey(Schema.Literals(["auto", "mp4", "webm", "mkv"])),
  videoQuality: Schema.optionalKey(Schema.Literals(["1080", "720", "480", "360", "240", "144"])),
  youtubeDubLang: Schema.optionalKey(cobaltLanguageSchema),
  subtitleLang: Schema.optionalKey(cobaltLanguageSchema),
  disableMetadata: Schema.optionalKey(Schema.Boolean),
  allowH265: Schema.optionalKey(Schema.Boolean),
  convertGif: Schema.optionalKey(Schema.Boolean),
  tiktokFullAudio: Schema.optionalKey(Schema.Boolean),
  youtubeBetterAudio: Schema.optionalKey(Schema.Boolean),
});

export type CobaltDownloadRequest = Schema.Schema.Type<typeof cobaltDownloadRequestSchema>;

const cobaltResponseErrorSchema = Schema.Struct({
  code: Schema.String,
  context: Schema.optionalKey(
    Schema.Struct({
      service: Schema.optionalKey(Schema.String),
      limit: Schema.optionalKey(Schema.Number),
    }),
  ),
});

const cobaltPickerItemSchema = Schema.Struct({
  type: Schema.Literals(["photo", "video", "gif"]),
  url: httpUrlSchema,
  thumb: Schema.optionalKey(httpUrlSchema),
});

const cobaltResponseMetadataSchema = Schema.Record(
  Schema.String,
  Schema.UndefinedOr(Schema.String),
);

const cobaltResponseSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("error"),
    error: cobaltResponseErrorSchema,
    critical: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({
    status: Schema.Literal("picker"),
    picker: Schema.Array(cobaltPickerItemSchema),
    audio: Schema.optionalKey(httpUrlSchema),
    audioFilename: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal("redirect"),
    url: httpUrlSchema,
    filename: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("tunnel"),
    url: httpUrlSchema,
    filename: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("local-processing"),
    type: Schema.Literals(["merge", "mute", "audio", "gif", "remux", "proxy"]),
    service: Schema.String,
    tunnel: Schema.Array(httpUrlSchema),
    output: Schema.Struct({
      type: Schema.String,
      filename: Schema.String,
      metadata: Schema.optionalKey(cobaltResponseMetadataSchema),
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
  }),
]);

export type CobaltDownloadResponse = Schema.Schema.Type<typeof cobaltResponseSchema>;

export type CobaltDownloadRuntimeEnv = {
  COBALT_API_URL?: string;
  COBALT_MACHINE_AFFINITY_SECRET?: string;
};

export type CobaltDownloadProxyContext = {
  request: Request;
  runtimeEnv: CobaltDownloadRuntimeEnv;
  machineId: string | undefined;
  parentRequestId: string;
  importId: string | undefined;
  trackIndex: number | undefined;
  sourceFingerprint: string;
};

export const decodeCobaltDownloadResponse = async (response: Response) => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Cobalt API returned non-JSON (${response.status}).`);
  }

  return Effect.runPromise(Schema.decodeUnknownEffect(cobaltResponseSchema)(await response.json()));
};

export const isCobaltCapacityError = (
  response: CobaltDownloadResponse,
): response is Extract<CobaltDownloadResponse, { status: "error" }> =>
  response.status === "error" && response.error.code === "error.api.capacity_exceeded";

const isCobaltTunnelUrl = (value: string, runtimeEnv: CobaltDownloadRuntimeEnv) => {
  if (!runtimeEnv.COBALT_API_URL) return false;

  try {
    const candidate = new URL(value);
    const cobalt = new URL(runtimeEnv.COBALT_API_URL);
    return candidate.origin === cobalt.origin && candidate.pathname === "/tunnel";
  } catch {
    return false;
  }
};

const toCobaltTunnelProxyUrl = (value: string, context: CobaltDownloadProxyContext) => {
  if (!isCobaltTunnelUrl(value, context.runtimeEnv)) return value;

  const proxyUrl = new URL("/api/cobalt/tunnel", context.request.url);
  proxyUrl.searchParams.set("url", value);
  proxyUrl.searchParams.set("kind", "video");
  if (context.machineId) {
    proxyUrl.searchParams.set("machine", context.machineId);
    proxyUrl.searchParams.set(
      "signature",
      signCobaltMachine(context.runtimeEnv, value, context.machineId),
    );
  }
  proxyUrl.searchParams.set("parentRequestId", context.parentRequestId);
  proxyUrl.searchParams.set("sourceFingerprint", context.sourceFingerprint);
  if (context.importId) proxyUrl.searchParams.set("importId", context.importId);
  if (context.trackIndex !== undefined) {
    proxyUrl.searchParams.set("trackIndex", String(context.trackIndex));
  }
  return `${proxyUrl.pathname}${proxyUrl.search}`;
};

const toCobaltPickerResourceProxyUrl = (value: string, context: CobaltDownloadProxyContext) => {
  if (isCobaltTunnelUrl(value, context.runtimeEnv)) {
    return toCobaltTunnelProxyUrl(value, context);
  }

  const proxyUrl = new URL("/api/cobalt/tunnel", context.request.url);
  const expiresAt = Math.floor(Date.now() / 1_000) + COBALT_RESOURCE_CAPABILITY_TTL_SECONDS;
  proxyUrl.searchParams.set("url", value);
  proxyUrl.searchParams.set("kind", "video");
  proxyUrl.searchParams.set("resource", "direct");
  proxyUrl.searchParams.set("expires", String(expiresAt));
  proxyUrl.searchParams.set("signature", signCobaltResource(context.runtimeEnv, value, expiresAt));
  proxyUrl.searchParams.set("parentRequestId", context.parentRequestId);
  proxyUrl.searchParams.set("sourceFingerprint", context.sourceFingerprint);
  if (context.importId) proxyUrl.searchParams.set("importId", context.importId);
  if (context.trackIndex !== undefined) {
    proxyUrl.searchParams.set("trackIndex", String(context.trackIndex));
  }
  return `${proxyUrl.pathname}${proxyUrl.search}`;
};

/**
 * Rewrites only Cobalt-generated tunnel URLs. Direct provider URLs and redirect
 * responses stay untouched; forced upstream processing should make those rare.
 */
export const proxyCobaltDownloadResponse = (
  response: CobaltDownloadResponse,
  context: CobaltDownloadProxyContext,
): CobaltDownloadResponse => {
  switch (response.status) {
    case "tunnel":
      return {
        ...response,
        url: toCobaltTunnelProxyUrl(response.url, context),
      };
    case "local-processing":
      return {
        ...response,
        tunnel: response.tunnel.map((value) => toCobaltTunnelProxyUrl(value, context)),
      };
    case "picker": {
      const picker = response.picker.map((item) => {
        const rewritten = {
          ...item,
          url: toCobaltPickerResourceProxyUrl(item.url, context),
        };
        if (item.thumb) rewritten.thumb = toCobaltTunnelProxyUrl(item.thumb, context);
        return rewritten;
      });
      const rewritten = { ...response, picker };
      if (response.audio) {
        rewritten.audio = toCobaltPickerResourceProxyUrl(response.audio, context);
      }
      return rewritten;
    }
    case "error":
    case "redirect":
      return response;
  }
};
