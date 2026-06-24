/*
 * Adapted from imputnet/cobalt:
 * - web/src/lib/types/api.ts
 * - web/src/lib/api/api.ts
 *
 * Changes: runs server-side in Tagium, uses server env for Cobalt URL/auth,
 * and returns the downloaded audio bytes to the browser.
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
        audioFormat: "best",
        audioBitrate,
        alwaysProxy: true,
        localProcessing: "disabled",
        filenameStyle: "pretty",
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

const probeCobaltTunnel = async (url: string) => {
  const response = await fetch(`${url}&p=1`, {
    signal: AbortSignal.timeout(COBALT_REQUEST_TIMEOUT_MS),
  }).catch(() => undefined);
  return response?.status === 200;
};

const fetchAudioResponse = async (url: string, filename: string) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(COBALT_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Cobalt file request failed (${response.status}).`);
  }

  if (response.headers.get("content-length") === "0") {
    throw new Error("Cobalt file response was empty.");
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "X-Tagium-Filename": encodeURIComponent(filename),
    },
  });
};

const cobaltErrorResponse = (message: string) =>
  new Response(message, {
    status: 502,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
    },
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

    const cobaltResponse = await requestCobaltAudio(runtimeEnv, body.url, body.audioBitrate);

    if (cobaltResponse.status === CobaltResponseType.Error) {
      return cobaltErrorResponse(cobaltResponse.error.code);
    }

    if (cobaltResponse.status === CobaltResponseType.LocalProcessing) {
      return cobaltErrorResponse(
        "Cobalt returned local processing; use a server-side tunnel instance.",
      );
    }

    if (cobaltResponse.status === CobaltResponseType.Picker) {
      if (!cobaltResponse.audio || !cobaltResponse.audioFilename) {
        return cobaltErrorResponse("Cobalt returned multiple items without a single audio file.");
      }

      return await fetchAudioResponse(cobaltResponse.audio, cobaltResponse.audioFilename);
    }

    if (cobaltResponse.status === CobaltResponseType.Tunnel) {
      const tunnelIsReady = await probeCobaltTunnel(cobaltResponse.url);
      if (!tunnelIsReady) {
        return cobaltErrorResponse("error.tunnel.probe");
      }
    }

    return await fetchAudioResponse(cobaltResponse.url, cobaltResponse.filename);
  } catch (error) {
    if (error instanceof Error) {
      return cobaltErrorResponse(error.message);
    }

    return cobaltErrorResponse("Download failed.");
  }
});
