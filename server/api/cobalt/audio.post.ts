/*
 * Adapted from imputnet/cobalt:
 * - web/src/lib/types/api.ts
 * - web/src/lib/api/api.ts
 *
 * Changes: runs server-side in Tagium, uses server env for Cobalt URL/auth,
 * and returns a browser-executable download plan without exposing auth.
 */
import { defineHandler } from "nitro";
import { env as processEnv } from "node:process";
import { z } from "zod";

enum CobaltResponseType {
  Error = "error",
  Picker = "picker",
  Redirect = "redirect",
  Tunnel = "tunnel",
  LocalProcessing = "local-processing",
}

const audioRequestSchema = z.object({
  url: z.string().url(),
  audioBitrate: z.enum(["320", "256", "128", "96", "64"]),
});

const cobaltResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal(CobaltResponseType.Error),
    error: z.object({
      code: z.string(),
    }),
  }),
  z.object({
    status: z.literal(CobaltResponseType.Picker),
    audio: z.string().url().optional(),
    audioFilename: z.string().optional(),
  }),
  z.object({
    status: z.literal(CobaltResponseType.Redirect),
    url: z.string().url(),
    filename: z.string(),
  }),
  z.object({
    status: z.literal(CobaltResponseType.Tunnel),
    url: z.string().url(),
    filename: z.string(),
  }),
  z.object({
    status: z.literal(CobaltResponseType.LocalProcessing),
    type: z.enum(["merge", "mute", "audio", "gif", "remux", "proxy"]),
    service: z.string(),
    tunnel: z.array(z.string().url()),
    output: z.object({
      type: z.string(),
      filename: z.string(),
      metadata: z.record(z.string(), z.string().optional()).optional(),
      subtitles: z.boolean().optional(),
    }),
    audio: z
      .object({
        copy: z.boolean(),
        format: z.string(),
        bitrate: z.string(),
        cover: z.boolean().optional(),
        cropCover: z.boolean().optional(),
      })
      .optional(),
    isHLS: z.boolean().optional(),
  }),
]);

type CobaltResponse = z.infer<typeof cobaltResponseSchema>;
type CobaltRuntimeEnv = {
  COBALT_ALLOWED_ORIGIN?: string;
  COBALT_API_KEY?: string;
  COBALT_API_URL?: string;
};
type CloudflareRequest = Request & {
  runtime?: {
    cloudflare?: {
      env?: CobaltRuntimeEnv;
    };
  };
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const COBALT_REQUEST_TIMEOUT_MS = 300_000;
const YOUTUBE_HLS_UNAVAILABLE_ERROR = "error.api.youtube.no_hls_streams";
const rateLimitBuckets = new Map<string, { startedAt: number; count: number }>();

const getRuntimeEnv = (request: Request): CobaltRuntimeEnv => ({
  ...processEnv,
  ...(request as CloudflareRequest).runtime?.cloudflare?.env,
});

const getCobaltApiUrl = (runtimeEnv: CobaltRuntimeEnv) => {
  if (!runtimeEnv.COBALT_API_URL) {
    throw new Error("COBALT_API_URL is not configured.");
  }

  return runtimeEnv.COBALT_API_URL;
};

const getCobaltHeaders = (runtimeEnv: CobaltRuntimeEnv) => {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (runtimeEnv.COBALT_API_KEY) {
    headers.Authorization = `Api-Key ${runtimeEnv.COBALT_API_KEY}`;
  }

  return headers;
};

const getRequestOrigin = (request: Request) => {
  const origin = request.headers.get("origin");

  if (!origin) {
    return undefined;
  }

  return origin;
};

const getAllowedOrigin = (
  request: Request,
  requestOrigin: string,
  runtimeEnv: CobaltRuntimeEnv,
) => {
  if (runtimeEnv.COBALT_ALLOWED_ORIGIN) {
    return runtimeEnv.COBALT_ALLOWED_ORIGIN;
  }

  return new URL(request.url, requestOrigin).origin;
};

const getClientKey = (request: Request) => {
  const cloudflareIp = request.headers.get("cf-connecting-ip");
  if (cloudflareIp) {
    return cloudflareIp;
  }

  return "unknown";
};

const enforceSameOrigin = (request: Request, runtimeEnv: CobaltRuntimeEnv) => {
  const requestOrigin = getRequestOrigin(request);
  if (!requestOrigin) {
    return new Response("Download requests require an Origin header.", { status: 403 });
  }

  const allowedOrigin = getAllowedOrigin(request, requestOrigin, runtimeEnv);
  if (requestOrigin !== allowedOrigin) {
    return new Response("Download origin is not allowed.", { status: 403 });
  }

  return undefined;
};

const enforceRateLimit = (request: Request) => {
  const clientKey = getClientKey(request);
  const now = Date.now();
  const bucket = rateLimitBuckets.get(clientKey);

  if (!bucket || now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(clientKey, { startedAt: now, count: 1 });
    return undefined;
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    return new Response("Download rate limit exceeded.", { status: 429 });
  }

  bucket.count += 1;
  return undefined;
};

const parseCobaltJson = async (response: Response) => {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    throw new Error(`Cobalt API returned non-JSON (${response.status}).`);
  }

  return cobaltResponseSchema.parse(await response.json());
};

const requestCobaltAudio = async (
  runtimeEnv: CobaltRuntimeEnv,
  url: string,
  audioBitrate: string,
  youtubeHLS: boolean,
) => {
  let response: Response;

  try {
    const endpoint = new URL("/", getCobaltApiUrl(runtimeEnv));
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(COBALT_REQUEST_TIMEOUT_MS),
      headers: getCobaltHeaders(runtimeEnv),
      body: JSON.stringify({
        url,
        downloadMode: "audio",
        audioFormat: "mp3",
        audioBitrate,
        alwaysProxy: true,
        localProcessing: "forced",
        filenameStyle: "pretty",
        youtubeHLS,
      }),
    });
  } catch (error) {
    let code = "error.api.unreachable";
    if (error instanceof Error && error.message.includes("timed out")) {
      code = "error.api.timed_out";
    }

    return {
      status: CobaltResponseType.Error,
      error: { code },
    } satisfies CobaltResponse;
  }

  try {
    return await parseCobaltJson(response);
  } catch (error) {
    let code = "error.api.invalid_response";
    if (error instanceof Error) {
      code = error.message;
    }

    return {
      status: CobaltResponseType.Error,
      error: { code },
    } satisfies CobaltResponse;
  }
};

const requestCobaltAudioWithHlsFallback = async (
  runtimeEnv: CobaltRuntimeEnv,
  url: string,
  audioBitrate: string,
) => {
  const response = await requestCobaltAudio(runtimeEnv, url, audioBitrate, true);

  if (
    response.status === CobaltResponseType.Error &&
    response.error.code === YOUTUBE_HLS_UNAVAILABLE_ERROR
  ) {
    return await requestCobaltAudio(runtimeEnv, url, audioBitrate, false);
  }

  return response;
};

const cobaltErrorResponse = (message: string) =>
  new Response(message, {
    status: 502,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
    },
  });

const toTunnelProxyUrl = (request: Request, tunnelUrl: string) => {
  const proxyUrl = new URL("/api/cobalt/tunnel", request.url);
  proxyUrl.searchParams.set("url", tunnelUrl);
  return `${proxyUrl.pathname}${proxyUrl.search}`;
};

const proxiedTunnelResponse = (
  request: Request,
  response: Extract<CobaltResponse, { url: string }>,
) =>
  Response.json({
    status: CobaltResponseType.Tunnel,
    url: toTunnelProxyUrl(request, response.url),
    filename: response.filename,
  });

const localProcessingResponse = (
  request: Request,
  response: Extract<CobaltResponse, { status: CobaltResponseType.LocalProcessing }>,
) =>
  Response.json({
    ...response,
    tunnel: response.tunnel.map((tunnelUrl) => toTunnelProxyUrl(request, tunnelUrl)),
  });

const parseAudioRequest = async (request: Request) => {
  try {
    return audioRequestSchema.parse(await request.json());
  } catch {
    return undefined;
  }
};

export default defineHandler(async (event) => {
  try {
    const runtimeEnv = getRuntimeEnv(event.req);
    const forbidden = enforceSameOrigin(event.req, runtimeEnv);
    if (forbidden) {
      return forbidden;
    }

    const limited = enforceRateLimit(event.req);
    if (limited) {
      return limited;
    }

    const body = await parseAudioRequest(event.req);
    if (!body) {
      return new Response("Invalid audio download request.", { status: 400 });
    }

    const cobaltResponse = await requestCobaltAudioWithHlsFallback(
      runtimeEnv,
      body.url,
      body.audioBitrate,
    );

    if (cobaltResponse.status === CobaltResponseType.Error) {
      return cobaltErrorResponse(cobaltResponse.error.code);
    }

    if (cobaltResponse.status === CobaltResponseType.LocalProcessing) {
      return localProcessingResponse(event.req, cobaltResponse);
    }

    if (cobaltResponse.status === CobaltResponseType.Picker) {
      if (!cobaltResponse.audio || !cobaltResponse.audioFilename) {
        return cobaltErrorResponse("Cobalt returned multiple items without a single audio file.");
      }

      return proxiedTunnelResponse(event.req, {
        status: CobaltResponseType.Tunnel,
        url: cobaltResponse.audio,
        filename: cobaltResponse.audioFilename,
      });
    }

    return proxiedTunnelResponse(event.req, cobaltResponse);
  } catch (error) {
    if (error instanceof Error) {
      return cobaltErrorResponse(error.message);
    }

    return cobaltErrorResponse("Download failed.");
  }
});
