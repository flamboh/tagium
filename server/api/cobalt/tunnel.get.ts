import { defineHandler } from "nitro";
import { env as processEnv } from "node:process";
import { Option, Schema } from "effect";
import {
  isCobaltMachineId,
  isValidCobaltMachineSignature,
  isValidCobaltResourceSignature,
} from "../../utils/cobalt-machine-affinity";
import {
  consumeTunnelDevFault,
  type CobaltRuntimeEnv as DevControlRuntimeEnv,
} from "../../utils/dev-controls";

type CobaltRuntimeEnv = {
  COBALT_API_URL?: string;
  COBALT_MACHINE_AFFINITY_SECRET?: string;
  TAGIUM_DEPLOY_ENV?: string;
} & DevControlRuntimeEnv;

type CloudflareRequest = Request & {
  runtime?: {
    cloudflare?: {
      env?: CobaltRuntimeEnv;
    };
  };
};

type TunnelObservabilityContext = {
  parentRequestId?: string;
  importId?: string;
  sourceFingerprint?: string;
  trackIndex?: number;
};
type TunnelLogContext = TunnelObservabilityContext & {
  requestId: string;
  machineId?: string;
  tunnelId?: string;
};

const COBALT_AUDIO_TUNNEL_TIMEOUT_MS = 5 * 60_000;
const EMPTY_BODY_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 4_000] as const;
const EMPTY_BODY_RETRY_ATTEMPTS = EMPTY_BODY_RETRY_DELAYS_MS.length + 1;
const EMPTY_BODY_RETRY_JITTER_RATIO = 0.2;
type TunnelOutcome = "ready" | "recovered" | "exhausted" | "non_retryable";

const getEmptyBodyRetryDelayMs = (baseDelayMs: number, tunnelUrl: URL, attempt: number) => {
  let hash = 0;
  for (const character of `${tunnelUrl.href}:${attempt}`) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  }

  const unitInterval = (hash >>> 0) / 0xffff_ffff;
  const jitterMultiplier =
    1 - EMPTY_BODY_RETRY_JITTER_RATIO + unitInterval * EMPTY_BODY_RETRY_JITTER_RATIO * 2;
  return Math.round(baseDelayMs * jitterMultiplier);
};

const withTunnelTelemetry = (headers: Headers, outcome: TunnelOutcome, attempts: number) => {
  headers.set("X-Tagium-Tunnel-Outcome", outcome);
  headers.set("X-Tagium-Tunnel-Attempts", String(attempts));
  return headers;
};

const tunnelTelemetryHeaders = (outcome: TunnelOutcome, attempts: number) =>
  withTunnelTelemetry(new Headers(), outcome, attempts);

const createTunnelRequestId = () => `tagium-tunnel-${crypto.randomUUID()}`;

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

const streamNonEmptyBody = async (response: Response) => {
  const reader = response.body?.getReader();
  if (!reader) {
    return undefined;
  }
  let firstChunk: ReadableStreamReadResult<Uint8Array>;
  try {
    firstChunk = await reader.read();
  } catch (error) {
    reader.releaseLock();
    throw error;
  }
  if (firstChunk.done) {
    reader.releaseLock();
    return undefined;
  }

  return new ReadableStream({
    start(controller) {
      controller.enqueue(firstChunk.value);
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          reader.releaseLock();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        try {
          await reader.cancel(error);
        } finally {
          reader.releaseLock();
        }
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    },
  });
};

const getTunnelLogContext = (
  requestId: string,
  tunnelUrl: URL | undefined,
  machineId: string | null | undefined,
  observability: TunnelObservabilityContext = {},
) => {
  const context: TunnelLogContext = { requestId, ...observability };
  if (machineId) {
    context.machineId = machineId;
  }
  if (tunnelUrl) {
    const tunnelId = tunnelUrl.searchParams.get("id");
    if (tunnelId) {
      context.tunnelId = tunnelId;
    }
  }

  return context;
};

const getTunnelObservabilityContext = (requestUrl: URL) => {
  const read = (name: string, pattern: RegExp) => {
    const value = requestUrl.searchParams.get(name);
    if (value === null) return undefined;
    if (!pattern.test(value)) throw new Error(`invalid ${name}`);
    return value;
  };

  const parentRequestId = read("parentRequestId", /^[A-Za-z0-9_-]{1,128}$/);
  const importId = read("importId", /^[A-Za-z0-9_-]{1,128}$/);
  const sourceFingerprint = read("sourceFingerprint", /^sha256:[a-f0-9]{32}$/);
  const rawTrackIndex = read("trackIndex", /^\d{1,5}$/);
  return {
    parentRequestId,
    importId,
    sourceFingerprint,
    trackIndex: rawTrackIndex === undefined ? undefined : Number(rawTrackIndex),
  };
};

const logTunnelFailure = (
  message: string,
  context: Record<string, string | number | undefined>,
) => {
  console.warn(JSON.stringify({ event: "cobalt_tunnel_failure", message, ...context }));
};

const cobaltCapacityErrorSchema = Schema.Struct({
  status: Schema.Literal("error"),
  error: Schema.Struct({ code: Schema.Literal("error.api.capacity_exceeded") }),
});
type CobaltCapacityError = Schema.Schema.Type<typeof cobaltCapacityErrorSchema>;
const decodeCobaltCapacityError = Schema.decodeUnknownOption(cobaltCapacityErrorSchema);

const tryParseCobaltCapacityError = (responseText: string) => {
  try {
    const decoded = decodeCobaltCapacityError(JSON.parse(responseText));
    return Option.isSome(decoded) ? decoded.value : undefined;
  } catch {
    return undefined;
  }
};

const cobaltCapacityErrorResponse = (
  body: CobaltCapacityError,
  retryAfter: string | null,
  attempts?: number,
) => {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (retryAfter) {
    headers.set("Retry-After", retryAfter);
  }
  if (attempts !== undefined) {
    withTunnelTelemetry(headers, "non_retryable", attempts);
  }

  return new Response(JSON.stringify(body), {
    status: 503,
    headers,
  });
};

const tunnelFailureResponseInit = (attempts: number): ResponseInit => {
  const init: ResponseInit = { status: 502 };
  if (attempts > 0) init.headers = tunnelTelemetryHeaders("non_retryable", attempts);
  return init;
};

const cobaltDevTunnelFaultResponse = (fault: ReturnType<typeof consumeTunnelDevFault>) => {
  if (fault === "rate-limit") {
    return new Response("Cobalt tunnel request failed (429).", {
      status: 502,
      headers: tunnelTelemetryHeaders("non_retryable", 1),
    });
  }

  if (fault === "capacity") {
    return cobaltCapacityErrorResponse(
      {
        status: "error",
        error: { code: "error.api.capacity_exceeded" },
      },
      "2",
      1,
    );
  }

  if (fault === "timeout") {
    // Dev faults happen before an upstream fetch. Use one synthetic attempt so
    // their telemetry has the same bounded shape as real tunnel responses.
    return new Response("Cobalt tunnel request timed out.", {
      status: 502,
      headers: tunnelTelemetryHeaders("non_retryable", 1),
    });
  }

  if (fault === "empty-body") {
    return new Response("Cobalt tunnel response was empty.", {
      status: 502,
      headers: tunnelTelemetryHeaders("exhausted", EMPTY_BODY_RETRY_ATTEMPTS),
    });
  }

  return undefined;
};

const parseTunnelRequest = (request: Request, runtimeEnv: CobaltRuntimeEnv) => {
  const requestUrl = new URL(request.url);
  const kind = requestUrl.searchParams.get("kind");
  if (kind !== null && kind !== "video") {
    return undefined;
  }
  const resource = requestUrl.searchParams.get("resource");
  if (resource !== null && resource !== "direct") {
    return undefined;
  }
  const tunnelUrlParam = requestUrl.searchParams.get("url");
  if (!tunnelUrlParam) {
    return undefined;
  }

  let tunnelUrl: URL;
  try {
    tunnelUrl = new URL(tunnelUrlParam);
  } catch {
    return undefined;
  }

  const machineId = requestUrl.searchParams.get("machine");
  const signature = requestUrl.searchParams.get("signature");
  if (resource === "direct") {
    const rawExpiresAt = requestUrl.searchParams.get("expires");
    const expiresAt = rawExpiresAt && /^\d{1,10}$/.test(rawExpiresAt) ? Number(rawExpiresAt) : NaN;
    if (
      kind !== "video" ||
      machineId !== null ||
      signature === null ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= Math.floor(Date.now() / 1_000) ||
      (tunnelUrl.protocol !== "http:" && tunnelUrl.protocol !== "https:") ||
      !isValidCobaltResourceSignature(runtimeEnv, tunnelUrlParam, expiresAt, signature)
    ) {
      return undefined;
    }

    try {
      return {
        tunnelUrl,
        machineId,
        kind,
        resource,
        observability: getTunnelObservabilityContext(requestUrl),
      };
    } catch {
      return undefined;
    }
  }

  const cobaltUrl = new URL(getCobaltApiUrl(runtimeEnv));
  if (tunnelUrl.origin !== cobaltUrl.origin || tunnelUrl.pathname !== "/tunnel") {
    return undefined;
  }

  if (machineId === null) {
    if (signature !== null) {
      return undefined;
    }

    try {
      return {
        tunnelUrl,
        machineId,
        kind,
        resource,
        observability: getTunnelObservabilityContext(requestUrl),
      };
    } catch {
      return undefined;
    }
  }

  if (!isCobaltMachineId(machineId) || signature === null) {
    return undefined;
  }

  if (!isValidCobaltMachineSignature(runtimeEnv, tunnelUrlParam, machineId, signature)) {
    return undefined;
  }

  try {
    return {
      tunnelUrl,
      machineId,
      kind,
      resource,
      observability: getTunnelObservabilityContext(requestUrl),
    };
  } catch {
    return undefined;
  }
};

export default defineHandler(async (event) => {
  const requestId = createTunnelRequestId();
  const startedAt = Date.now();
  let tunnelUrl: URL | undefined;
  let machineId: string | null | undefined;
  let observability: TunnelObservabilityContext = {};
  let upstreamAttempts = 0;

  try {
    const runtimeEnv = getRuntimeEnv(event.req);
    const devFault = consumeTunnelDevFault(event.req, runtimeEnv);
    const devFaultResponse = cobaltDevTunnelFaultResponse(devFault);
    if (devFaultResponse) {
      return devFaultResponse;
    }

    const tunnelRequest = parseTunnelRequest(event.req, runtimeEnv);
    if (!tunnelRequest) {
      logTunnelFailure("invalid tunnel url", { requestId, elapsedMs: Date.now() - startedAt });
      return new Response("Invalid Cobalt tunnel URL.", { status: 400 });
    }

    tunnelUrl = tunnelRequest.tunnelUrl;
    machineId = tunnelRequest.machineId;
    observability = tunnelRequest.observability;
    const requestHeaders = new Headers();
    requestHeaders.set("X-Tagium-Tunnel-Request-Id", requestId);
    if (observability.parentRequestId) {
      requestHeaders.set("X-Tagium-Parent-Request-Id", observability.parentRequestId);
    }
    if (observability.importId) {
      requestHeaders.set("X-Tagium-Import-Id", observability.importId);
    }
    if (observability.sourceFingerprint) {
      requestHeaders.set("X-Tagium-Source-Fingerprint", observability.sourceFingerprint);
    }
    if (observability.trackIndex !== undefined) {
      requestHeaders.set("X-Tagium-Track-Index", String(observability.trackIndex));
    }
    if (tunnelRequest.machineId) {
      requestHeaders.set("Fly-Force-Instance-Id", tunnelRequest.machineId);
    }

    const fetchSignal =
      tunnelRequest.kind === "video"
        ? event.req.signal
        : AbortSignal.any([AbortSignal.timeout(COBALT_AUDIO_TUNNEL_TIMEOUT_MS), event.req.signal]);
    let response: Response | undefined;
    let body: ReadableStream<Uint8Array> | undefined;
    for (let attempt = 1; attempt <= EMPTY_BODY_RETRY_ATTEMPTS; attempt++) {
      upstreamAttempts = attempt;
      response = await fetch(tunnelRequest.tunnelUrl, {
        headers: requestHeaders,
        redirect: tunnelRequest.resource === "direct" ? "follow" : "manual",
        signal: fetchSignal,
      });
      if (!response.ok) break;
      body = await streamNonEmptyBody(response);
      if (body || attempt === EMPTY_BODY_RETRY_ATTEMPTS) break;
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          done(
            fetchSignal.reason instanceof Error
              ? fetchSignal.reason
              : new Error("tunnel retry aborted"),
          );
        };
        const done = (error?: Error) => {
          fetchSignal.removeEventListener("abort", onAbort);
          if (error === undefined) resolve();
          else reject(error);
        };
        const retryDelayMs = getEmptyBodyRetryDelayMs(
          EMPTY_BODY_RETRY_DELAYS_MS[attempt - 1],
          tunnelRequest.tunnelUrl,
          attempt,
        );
        const timer = setTimeout(() => done(), retryDelayMs);
        if (fetchSignal.aborted) {
          onAbort();
          return;
        }
        fetchSignal.addEventListener("abort", onAbort, { once: true });
      });
    }
    if (!response) throw new Error("tunnel.fetch_missing");

    if (!response.ok) {
      const responseText = await response.text();
      const capacityError =
        response.status === 503 ? tryParseCobaltCapacityError(responseText) : undefined;
      if (capacityError) {
        logTunnelFailure("upstream capacity exceeded", {
          ...getTunnelLogContext(requestId, tunnelUrl, machineId, observability),
          elapsedMs: Date.now() - startedAt,
          status: response.status,
          retryAfter: response.headers.get("Retry-After") ?? undefined,
        });
        return cobaltCapacityErrorResponse(
          capacityError,
          response.headers.get("Retry-After"),
          upstreamAttempts,
        );
      }

      logTunnelFailure("upstream non-ok", {
        ...getTunnelLogContext(requestId, tunnelUrl, machineId, observability),
        elapsedMs: Date.now() - startedAt,
        status: response.status,
        responseBytes: new TextEncoder().encode(responseText).byteLength,
        contentType: response.headers.get("content-type") ?? undefined,
      });
      return new Response(`Cobalt tunnel request failed (${response.status}).`, {
        status: 502,
        headers: tunnelTelemetryHeaders("non_retryable", upstreamAttempts),
      });
    }

    if (!body) {
      logTunnelFailure("upstream empty body", {
        ...getTunnelLogContext(requestId, tunnelUrl, machineId, observability),
        elapsedMs: Date.now() - startedAt,
        status: response.status,
        contentLength: response.headers.get("content-length") ?? undefined,
      });
      return new Response("Cobalt tunnel response was empty.", {
        status: 502,
        headers: tunnelTelemetryHeaders("exhausted", upstreamAttempts),
      });
    }

    const responseHeaders = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) {
      responseHeaders.set("Content-Type", contentType);
    }
    const estimatedLength =
      response.headers.get("estimated-content-length") ?? response.headers.get("content-length");
    if (estimatedLength && /^\d+$/.test(estimatedLength) && estimatedLength !== "0") {
      responseHeaders.set("Estimated-Content-Length", estimatedLength);
    }
    responseHeaders.set("Cache-Control", "private, no-store");

    withTunnelTelemetry(
      responseHeaders,
      upstreamAttempts > 1 ? "recovered" : "ready",
      upstreamAttempts,
    );
    return new Response(body, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof Error) {
      logTunnelFailure("fetch threw", {
        ...getTunnelLogContext(requestId, tunnelUrl, machineId, observability),
        elapsedMs: Date.now() - startedAt,
        errorName: error.name,
      });
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        return new Response("Cobalt tunnel request timed out.", {
          ...tunnelFailureResponseInit(upstreamAttempts),
        });
      }
      return new Response(error.message, {
        ...tunnelFailureResponseInit(upstreamAttempts),
      });
    }

    logTunnelFailure("fetch threw non-error", {
      ...getTunnelLogContext(requestId, tunnelUrl, machineId, observability),
      elapsedMs: Date.now() - startedAt,
    });
    return new Response("Cobalt tunnel request failed.", {
      ...tunnelFailureResponseInit(upstreamAttempts),
    });
  }
});
