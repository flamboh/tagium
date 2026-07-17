/*
 * Adapted from imputnet/cobalt:
 * - web/src/lib/types/api.ts
 * - web/src/lib/api/api.ts
 *
 * Changes: runs server-side in Tagium, uses server env for Cobalt URL/auth,
 * and returns a browser-executable download plan without exposing auth.
 */
import { Effect, Schema } from "effect";
import { defineHandler, HTTPError } from "nitro";
import { env as processEnv } from "node:process";
import { parseCobaltMachineId, signCobaltMachine } from "../../utils/cobalt-machine-affinity";
import {
  createCloudflareCobaltRequestAdmission,
  createInMemoryCobaltRequestAdmission,
  type CloudflareRateLimitBinding,
  type CobaltRequestAdmission,
} from "../../utils/cobalt-request-admission";
import {
  consumeAudioDevFault,
  enforceRateLimit,
  getDeployEnv,
  type CobaltRuntimeEnv as DevControlRuntimeEnv,
} from "../../utils/dev-controls";
import { decodeRequestBody, urlStringSchema } from "../../utils/schema";
import { getYouTubeVideoId, resolveYouTubeUploadYear } from "../../utils/youtube";

enum CobaltResponseType {
  Error = "error",
  Picker = "picker",
  Redirect = "redirect",
  Tunnel = "tunnel",
  LocalProcessing = "local-processing",
}

const audioRequestSchema = Schema.Struct({
  url: urlStringSchema,
  audioBitrate: Schema.Literals(["320", "256", "128", "96", "64"]),
  year: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1_000, maximum: 9_999 })),
  ),
});

const cobaltResponseSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal(CobaltResponseType.Error),
    error: Schema.Struct({
      code: Schema.String,
    }),
  }),
  Schema.Struct({
    status: Schema.Literal(CobaltResponseType.Picker),
    audio: Schema.optionalKey(urlStringSchema),
    audioFilename: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal(CobaltResponseType.Redirect),
    url: urlStringSchema,
    filename: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal(CobaltResponseType.Tunnel),
    url: urlStringSchema,
    filename: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal(CobaltResponseType.LocalProcessing),
    type: Schema.Literals(["merge", "mute", "audio", "gif", "remux", "proxy"]),
    service: Schema.String,
    tunnel: Schema.Array(urlStringSchema),
    output: Schema.Struct({
      type: Schema.String,
      filename: Schema.String,
      metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.UndefinedOr(Schema.String))),
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

type CobaltResponse = Schema.Schema.Type<typeof cobaltResponseSchema>;
type CobaltAudioResult = {
  response: CobaltResponse;
  machineId: string | undefined;
  retryAfter: string | undefined;
};
type CobaltRuntimeEnv = {
  COBALT_ALLOWED_ORIGIN?: string;
  COBALT_API_KEY?: string;
  COBALT_API_URL?: string;
  COBALT_CLIENT_RATE_LIMITER?: CloudflareRateLimitBinding;
  COBALT_MACHINE_AFFINITY_SECRET?: string;
  COBALT_SESSION_RATE_LIMITER?: CloudflareRateLimitBinding;
} & DevControlRuntimeEnv;
type CloudflareRequest = Request & {
  runtime?: {
    cloudflare?: {
      env?: CobaltRuntimeEnv;
    };
  };
};

const COBALT_REQUEST_TIMEOUT_MS = 300_000;

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

const parseCobaltJson = async (response: Response) => {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    throw new Error(`Cobalt API returned non-JSON (${response.status}).`);
  }

  return Effect.runPromise(Schema.decodeUnknownEffect(cobaltResponseSchema)(await response.json()));
};

const isCobaltCapacityError = (response: CobaltResponse) =>
  response.status === CobaltResponseType.Error &&
  response.error.code === "error.api.capacity_exceeded";

const requestCobaltAudio = async (
  runtimeEnv: CobaltRuntimeEnv,
  url: string,
  audioBitrate: string,
  requestSignal: AbortSignal,
): Promise<CobaltAudioResult> => {
  let response: Response;

  try {
    const endpoint = new URL("/", getCobaltApiUrl(runtimeEnv));
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.any([requestSignal, AbortSignal.timeout(COBALT_REQUEST_TIMEOUT_MS)]),
      headers: getCobaltHeaders(runtimeEnv),
      body: JSON.stringify({
        url,
        downloadMode: "audio",
        audioFormat: "mp3",
        audioBitrate,
        alwaysProxy: true,
        localProcessing: "forced",
        filenameStyle: "pretty",
        youtubeHLS: false,
      }),
    });
  } catch (error) {
    let code = "error.api.unreachable";
    if (error instanceof Error && error.message.includes("timed out")) {
      code = "error.api.timed_out";
    }

    return {
      response: {
        status: CobaltResponseType.Error,
        error: { code },
      },
      machineId: undefined,
      retryAfter: undefined,
    };
  }

  try {
    return {
      response: await parseCobaltJson(response),
      machineId: parseCobaltMachineId(response.headers.get("X-Cobalt-Machine-Id")),
      retryAfter: response.headers.get("Retry-After") ?? undefined,
    };
  } catch (error) {
    let code = "error.api.invalid_response";
    if (error instanceof Error) {
      code = error.message;
    }

    return {
      response: {
        status: CobaltResponseType.Error,
        error: { code },
      },
      machineId: undefined,
      retryAfter: undefined,
    };
  }
};

const cobaltErrorResponse = (message: string) =>
  new Response(message, {
    status: 502,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
    },
  });

const cobaltCapacityErrorResponse = (response: CobaltResponse, retryAfter: string | undefined) => {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (retryAfter) {
    headers.set("Retry-After", retryAfter);
  }

  return new Response(JSON.stringify(response), {
    status: 503,
    headers,
  });
};

const cobaltDevCapacityResponse = () =>
  cobaltCapacityErrorResponse(
    {
      status: CobaltResponseType.Error,
      error: { code: "error.api.capacity_exceeded" },
    },
    "2",
  );

const cobaltDevFaultResponse = (fault: ReturnType<typeof consumeAudioDevFault>) => {
  if (fault === "rate-limit") {
    return new Response("Download rate limit exceeded.", { status: 429 });
  }

  if (fault === "capacity") {
    return cobaltDevCapacityResponse();
  }

  if (fault === "timeout") {
    return cobaltErrorResponse("error.api.timed_out");
  }

  if (fault === "unreachable") {
    return cobaltErrorResponse("error.api.unreachable");
  }

  if (fault === "malformed") {
    return Response.json({ status: "dev.malformed" });
  }

  return undefined;
};

const toTunnelProxyUrl = (
  request: Request,
  runtimeEnv: CobaltRuntimeEnv,
  tunnelUrl: string,
  machineId: string | undefined,
) => {
  const proxyUrl = new URL("/api/cobalt/tunnel", request.url);
  proxyUrl.searchParams.set("url", tunnelUrl);
  if (machineId) {
    proxyUrl.searchParams.set("machine", machineId);
    proxyUrl.searchParams.set("signature", signCobaltMachine(runtimeEnv, tunnelUrl, machineId));
  }
  return `${proxyUrl.pathname}${proxyUrl.search}`;
};

const proxiedTunnelResponse = (
  request: Request,
  runtimeEnv: CobaltRuntimeEnv,
  response: Extract<CobaltResponse, { url: string }>,
  machineId: string | undefined,
) =>
  Response.json({
    status: CobaltResponseType.Tunnel,
    url: toTunnelProxyUrl(request, runtimeEnv, response.url, machineId),
    filename: response.filename,
  });

const localProcessingResponse = (
  request: Request,
  runtimeEnv: CobaltRuntimeEnv,
  response: Extract<CobaltResponse, { status: CobaltResponseType.LocalProcessing }>,
  machineId: string | undefined,
) =>
  Response.json({
    ...response,
    tunnel: response.tunnel.map((tunnelUrl) =>
      toTunnelProxyUrl(request, runtimeEnv, tunnelUrl, machineId),
    ),
  });

const withYearMetadata = (
  response: Extract<CobaltResponse, { status: CobaltResponseType.LocalProcessing }>,
  year: number | undefined,
) => {
  if (year === undefined) return response;
  return {
    ...response,
    output: {
      ...response.output,
      metadata: {
        ...response.output.metadata,
        date: String(year),
      },
    },
  };
};

const getCobaltRequestAdmission = (
  request: Request,
  runtimeEnv: CobaltRuntimeEnv,
): CobaltRequestAdmission | undefined => {
  if (runtimeEnv.COBALT_SESSION_RATE_LIMITER && runtimeEnv.COBALT_CLIENT_RATE_LIMITER) {
    return createCloudflareCobaltRequestAdmission({
      sessionLimiter: runtimeEnv.COBALT_SESSION_RATE_LIMITER,
      clientLimiter: runtimeEnv.COBALT_CLIENT_RATE_LIMITER,
    });
  }

  if (getDeployEnv(request, runtimeEnv).deployEnv === "local") {
    return createInMemoryCobaltRequestAdmission(enforceRateLimit);
  }

  return undefined;
};

const admissionUnavailableResponse = () =>
  new Response("Download admission is unavailable.", {
    status: 503,
    headers: { "Retry-After": "2" },
  });

const admissionLimitedResponse = () =>
  new Response("Download rate limit exceeded.", {
    status: 429,
    headers: { "Retry-After": "60" },
  });

const withAdmissionCookie = (response: Response, setCookie: string | undefined) => {
  if (setCookie) response.headers.append("Set-Cookie", setCookie);
  return response;
};

export default defineHandler(async (event) => {
  try {
    const runtimeEnv = getRuntimeEnv(event.req);
    const forbidden = enforceSameOrigin(event.req, runtimeEnv);
    if (forbidden) {
      return forbidden;
    }

    const devFault = consumeAudioDevFault(event.req, runtimeEnv);
    const devFaultResponse = cobaltDevFaultResponse(devFault);
    if (devFaultResponse) {
      return devFaultResponse;
    }

    const body = await decodeRequestBody(event.req, audioRequestSchema);

    const admission = getCobaltRequestAdmission(event.req, runtimeEnv);
    if (!admission) return admissionUnavailableResponse();

    const admissionDecision = await admission.admit(event.req);
    const respond = (response: Response) =>
      withAdmissionCookie(response, admissionDecision.setCookie);
    if (admissionDecision.status === "unavailable") {
      return respond(admissionUnavailableResponse());
    }
    if (admissionDecision.status === "limited") {
      return respond(admissionLimitedResponse());
    }

    const yearPromise =
      body.year !== undefined
        ? Promise.resolve(body.year)
        : getYouTubeVideoId(body.url)
          ? resolveYouTubeUploadYear(body.url, { signal: event.req.signal }).catch(() => undefined)
          : Promise.resolve(undefined);
    const cobaltResult = await requestCobaltAudio(
      runtimeEnv,
      body.url,
      body.audioBitrate,
      event.req.signal,
    );
    const cobaltResponse = cobaltResult.response;

    if (isCobaltCapacityError(cobaltResponse)) {
      return respond(cobaltCapacityErrorResponse(cobaltResponse, cobaltResult.retryAfter));
    }

    if (cobaltResponse.status === CobaltResponseType.Error) {
      return respond(cobaltErrorResponse(cobaltResponse.error.code));
    }

    if (cobaltResponse.status === CobaltResponseType.LocalProcessing) {
      const responseWithYear = withYearMetadata(cobaltResponse, await yearPromise);
      return respond(
        localProcessingResponse(event.req, runtimeEnv, responseWithYear, cobaltResult.machineId),
      );
    }

    if (cobaltResponse.status === CobaltResponseType.Picker) {
      if (!cobaltResponse.audio || !cobaltResponse.audioFilename) {
        return respond(
          cobaltErrorResponse("Cobalt returned multiple items without a single audio file."),
        );
      }

      return respond(
        proxiedTunnelResponse(
          event.req,
          runtimeEnv,
          {
            status: CobaltResponseType.Tunnel,
            url: cobaltResponse.audio,
            filename: cobaltResponse.audioFilename,
          },
          cobaltResult.machineId,
        ),
      );
    }

    return respond(
      proxiedTunnelResponse(event.req, runtimeEnv, cobaltResponse, cobaltResult.machineId),
    );
  } catch (error) {
    if (HTTPError.isError(error)) throw error;

    if (error instanceof Error) {
      return cobaltErrorResponse(error.message);
    }

    return cobaltErrorResponse("Download failed.");
  }
});
