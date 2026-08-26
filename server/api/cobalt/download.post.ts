import { defineHandler, HTTPError } from "nitro";
import { env as processEnv } from "node:process";
import { parseCobaltMachineId } from "../../utils/cobalt-machine-affinity";
import {
  getCobaltRequestAdmission,
  type CloudflareRateLimitBinding,
} from "../../utils/cobalt-request-admission";
import {
  cobaltDownloadRequestSchema,
  decodeCobaltDownloadResponse,
  isCobaltCapacityError,
  proxyCobaltDownloadResponse,
  type CobaltDownloadRequest,
  type CobaltDownloadResponse,
} from "../../utils/cobalt-download-response";
import {
  fingerprintUrl,
  getRequestLogContext,
  type RequestLogContext,
} from "../../utils/request-observability";
import { decodeRequestBody } from "../../utils/schema";
import type { CobaltRuntimeEnv as DevControlRuntimeEnv } from "../../utils/dev-controls";

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

type CobaltDownloadResult = {
  response: CobaltDownloadResponse;
  machineId: string | undefined;
  retryAfter: string | undefined;
  upstreamStatus?: number;
  contentType?: string;
  failureStage?: "cobalt.resolve_fetch" | "cobalt.resolve_parse" | "cobalt.resolve_policy";
  failureReason?:
    | "fetch_threw"
    | "non_json"
    | "invalid_json_or_schema"
    | "invalid_machine_id"
    | "remote_processing_plan";
};

const COBALT_REQUEST_TIMEOUT_MS = 300_000;

const getRuntimeEnv = (request: Request): CobaltRuntimeEnv => ({
  ...processEnv,
  // SAFETY: Nitro's Cloudflare adapter supplies this request shape in the Cloudflare runtime.
  ...(request as CloudflareRequest).runtime?.cloudflare?.env,
});

const getCobaltApiUrl = (runtimeEnv: CobaltRuntimeEnv) => {
  if (!runtimeEnv.COBALT_API_URL) {
    throw new Error("COBALT_API_URL is not configured.");
  }

  return runtimeEnv.COBALT_API_URL;
};

const getRequestHeaders = (
  runtimeEnv: CobaltRuntimeEnv,
  context: RequestLogContext,
  sourceFingerprint: string,
) => {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Tagium-Request-Id": context.requestId,
    "X-Tagium-Source-Fingerprint": sourceFingerprint,
  });
  if (context.importId) headers.set("X-Tagium-Import-Id", context.importId);
  if (context.trackIndex !== undefined) {
    headers.set("X-Tagium-Track-Index", String(context.trackIndex));
  }
  if (runtimeEnv.COBALT_API_KEY) {
    headers.set("Authorization", `Api-Key ${runtimeEnv.COBALT_API_KEY}`);
  }
  return headers;
};

const getAllowedOrigin = (request: Request, requestOrigin: string, runtimeEnv: CobaltRuntimeEnv) =>
  runtimeEnv.COBALT_ALLOWED_ORIGIN ?? new URL(request.url, requestOrigin).origin;

const enforceSameOrigin = (request: Request, runtimeEnv: CobaltRuntimeEnv) => {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin) {
    return new Response("Download requests require an Origin header.", { status: 403 });
  }

  if (requestOrigin !== getAllowedOrigin(request, requestOrigin, runtimeEnv)) {
    return new Response("Download origin is not allowed.", { status: 403 });
  }

  return undefined;
};

const requestCobaltDownload = async (
  runtimeEnv: CobaltRuntimeEnv,
  body: CobaltDownloadRequest,
  requestSignal: AbortSignal,
  context: RequestLogContext,
  sourceFingerprint: string,
): Promise<CobaltDownloadResult> => {
  let response: Response;
  try {
    const endpoint = new URL("/", getCobaltApiUrl(runtimeEnv));
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.any([requestSignal, AbortSignal.timeout(COBALT_REQUEST_TIMEOUT_MS)]),
      headers: getRequestHeaders(runtimeEnv, context, sourceFingerprint),
      body: JSON.stringify({
        ...body,
        // These controls are intentionally not public. Video downloads must remain
        // browser-processable and all generated Cobalt streams must be reachable.
        alwaysProxy: true,
        localProcessing: "forced",
        youtubeHLS: false,
      }),
    });
  } catch (error) {
    const code =
      error instanceof Error && error.name === "TimeoutError"
        ? "error.api.timed_out"
        : "error.api.unreachable";
    return {
      response: { status: "error", error: { code } },
      machineId: undefined,
      retryAfter: undefined,
      failureStage: "cobalt.resolve_fetch",
      failureReason: "fetch_threw",
    };
  }

  const upstreamStatus = response.status;
  const contentType = response.headers.get("content-type") ?? undefined;
  try {
    return {
      response: await decodeCobaltDownloadResponse(response),
      machineId: parseCobaltMachineId(response.headers.get("X-Cobalt-Machine-Id")),
      retryAfter: response.headers.get("Retry-After") ?? undefined,
      upstreamStatus,
      contentType,
    };
  } catch (error) {
    const invalidMachineId =
      error instanceof Error && error.message === "Cobalt returned invalid machine id.";
    const nonJson =
      error instanceof Error && error.message.startsWith("Cobalt API returned non-JSON");
    return {
      response: {
        status: "error",
        error: { code: "error.api.invalid_response" },
      },
      machineId: undefined,
      retryAfter: response.headers.get("Retry-After") ?? undefined,
      upstreamStatus,
      contentType,
      failureStage: "cobalt.resolve_parse",
      failureReason: invalidMachineId
        ? "invalid_machine_id"
        : nonJson
          ? "non_json"
          : "invalid_json_or_schema",
    };
  }
};

const publicCobaltErrorCode = (code: string) => {
  if (
    code.startsWith("error.api.fetch.soundcloud.stream_fetch") ||
    code.startsWith("error.api.fetch.soundcloud.stream_parse")
  ) {
    return "error.api.fetch.empty";
  }
  return code.startsWith("error.api.fetch.soundcloud.") ? "error.api.fetch.fail" : code;
};

const withPublicErrorCode = (response: Extract<CobaltDownloadResponse, { status: "error" }>) => ({
  ...response,
  error: {
    ...response.error,
    code: publicCobaltErrorCode(response.error.code),
  },
});

const cobaltErrorResponse = (response: CobaltDownloadResponse, status = 502) =>
  Response.json(response, {
    status,
    headers: { "Content-Type": "application/json" },
  });

const cobaltCapacityErrorResponse = (
  response: Extract<CobaltDownloadResponse, { status: "error" }>,
  retryAfter: string | undefined,
) => {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("Retry-After", retryAfter ?? "2");
  return new Response(JSON.stringify(response), { status: 503, headers });
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

const logCompletion = (
  context: RequestLogContext,
  sourceFingerprint: string,
  result: CobaltDownloadResult,
  elapsedMs: number,
) => {
  console.info(
    JSON.stringify({
      event: "cobalt_video_completion",
      requestId: context.requestId,
      sourceFingerprint,
      elapsedMs,
      outcome: result.response.status,
      upstreamStatus: result.upstreamStatus,
      machineId: result.machineId,
    }),
  );
};

const logFailure = (
  context: RequestLogContext,
  sourceFingerprint: string,
  result: CobaltDownloadResult,
  elapsedMs: number,
) => {
  console.warn(
    JSON.stringify({
      event: "cobalt_video_failure",
      requestId: context.requestId,
      sourceFingerprint,
      elapsedMs,
      stage: result.failureStage ?? "cobalt.resolve_error",
      errorCode: result.response.status === "error" ? result.response.error.code : undefined,
      upstreamStatus: result.upstreamStatus,
      contentType: result.contentType,
      retryAfter: result.retryAfter,
      machineId: result.machineId,
      failureReason: result.failureReason,
    }),
  );
};

export default defineHandler(async (event) => {
  const startedAt = Date.now();
  let context = getRequestLogContext(event.req);
  let sourceFingerprint: string | undefined;

  try {
    const runtimeEnv = getRuntimeEnv(event.req);
    const forbidden = enforceSameOrigin(event.req, runtimeEnv);
    if (forbidden) return forbidden;

    const body = await decodeRequestBody(event.req, cobaltDownloadRequestSchema);
    context = getRequestLogContext(event.req, body.url);
    const requestSourceFingerprint = await fingerprintUrl(body.url);
    if (!requestSourceFingerprint) throw new Error("Download URL fingerprint is unavailable.");
    sourceFingerprint = requestSourceFingerprint;

    const admission = getCobaltRequestAdmission(event.req, runtimeEnv);
    if (!admission) return admissionUnavailableResponse();

    const admissionDecision = await admission.admit(event.req);
    const respond = (response: Response) => {
      response.headers.set("X-Tagium-Request-Id", context.requestId);
      return withAdmissionCookie(response, admissionDecision.setCookie);
    };
    if (admissionDecision.status === "unavailable") {
      return respond(admissionUnavailableResponse());
    }
    if (admissionDecision.status === "limited") {
      return respond(admissionLimitedResponse());
    }

    const result = await requestCobaltDownload(
      runtimeEnv,
      body,
      event.req.signal,
      context,
      requestSourceFingerprint,
    );
    if (result.response.status === "error") {
      logFailure(context, requestSourceFingerprint, result, Date.now() - startedAt);
      if (isCobaltCapacityError(result.response)) {
        return respond(cobaltCapacityErrorResponse(result.response, result.retryAfter));
      }
      return respond(cobaltErrorResponse(withPublicErrorCode(result.response)));
    }

    if (result.response.status === "tunnel") {
      // In the pinned Cobalt contract, forced local processing only leaves HLS
      // plans as top-level tunnels. Fetching one would execute ffmpeg on Fly.
      const policyFailure = {
        ...result,
        response: {
          status: "error",
          error: { code: "error.api.service.unsupported" },
        },
        failureStage: "cobalt.resolve_policy",
        failureReason: "remote_processing_plan",
      } as const satisfies CobaltDownloadResult;
      logFailure(context, requestSourceFingerprint, policyFailure, Date.now() - startedAt);
      return respond(cobaltErrorResponse(policyFailure.response, 422));
    }

    logCompletion(context, requestSourceFingerprint, result, Date.now() - startedAt);

    const proxiedResponse = proxyCobaltDownloadResponse(result.response, {
      request: event.req,
      runtimeEnv,
      machineId: result.machineId,
      parentRequestId: context.requestId,
      importId: context.importId,
      trackIndex: context.trackIndex,
      sourceFingerprint: requestSourceFingerprint,
    });
    return respond(Response.json(proxiedResponse));
  } catch (error) {
    if (HTTPError.isError(error)) throw error;

    if (sourceFingerprint) {
      console.warn(
        JSON.stringify({
          event: "cobalt_video_failure",
          requestId: context.requestId,
          sourceFingerprint,
          stage: "tagium.video_handler",
          elapsedMs: Date.now() - startedAt,
          errorType: error instanceof Error ? error.name : "UnknownError",
          errorCode: "error.api.handler_failure",
        }),
      );
    }
    return cobaltErrorResponse({
      status: "error",
      error: { code: "error.api.handler_failure" },
    });
  }
});
