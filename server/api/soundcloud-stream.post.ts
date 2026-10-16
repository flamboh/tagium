import { Effect, Schema } from "effect";
import { defineHandler } from "nitro";
import { env as processEnv } from "node:process";
import {
  getSoundCloudRequestAdmission,
  type SoundCloudAdmissionRuntimeEnv,
} from "../utils/download-request-admission";
import { reportDownloadFailure } from "../utils/download-failure-report";
import { enforceSameOrigin } from "../utils/same-origin";
import { decodeRequestBody, urlStringSchema } from "../utils/schema";
import { getSoundCloudLogContext } from "../utils/soundcloud-observability";
import {
  isSoundCloudTrackUrl,
  normalizeTrackSourceUrl,
  resolveSoundCloudStream,
} from "../utils/soundcloud-track";

type SoundCloudStreamRuntimeEnv = {
  COBALT_ALLOWED_ORIGIN?: string;
} & SoundCloudAdmissionRuntimeEnv;

type CloudflareRequest = Request & {
  runtime?: { cloudflare?: { env?: SoundCloudStreamRuntimeEnv } };
};

const streamRequestSchema = Schema.Struct({ url: urlStringSchema });

const getRuntimeEnv = (request: Request): SoundCloudStreamRuntimeEnv => ({
  ...processEnv,
  // SAFETY: Nitro's Cloudflare adapter supplies this request shape in the Cloudflare runtime.
  ...(request as CloudflareRequest).runtime?.cloudflare?.env,
});

const errorResponse = (code: string) =>
  new Response(code, { status: 502, headers: { "Content-Type": "text/plain;charset=UTF-8" } });

const isUnreportedCode = (code: string) => code === "error.api.content.video.unavailable";

export default defineHandler(async (event) => {
  const runtimeEnv = getRuntimeEnv(event.req);
  const forbidden = enforceSameOrigin(event.req, runtimeEnv.COBALT_ALLOWED_ORIGIN);

  if (forbidden) return forbidden;

  const body = await decodeRequestBody(event.req, streamRequestSchema);
  const admission = getSoundCloudRequestAdmission(event.req, runtimeEnv);

  if (!admission) {
    return new Response("Download admission is unavailable.", {
      status: 503,
      headers: { "Retry-After": "2" },
    });
  }

  const decision = await admission.admit(event.req);

  const respond = (response: Response) => {
    if (decision.setCookie) response.headers.append("Set-Cookie", decision.setCookie);

    return response;
  };

  if (decision.status === "unavailable") {
    return respond(
      new Response("Download admission is unavailable.", {
        status: 503,
        headers: { "Retry-After": "2" },
      }),
    );
  }

  if (decision.status === "limited") {
    return respond(
      new Response("Download rate limit exceeded.", {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    );
  }

  const sourceUrl = await normalizeTrackSourceUrl(body.url, event.req.signal).catch(
    () => undefined,
  );

  if (!sourceUrl || !isSoundCloudTrackUrl(sourceUrl)) {
    return respond(new Response("error.api.link.unsupported", { status: 400 }));
  }

  const context = getSoundCloudLogContext(event.req, sourceUrl);

  const result = await Effect.runPromise(
    resolveSoundCloudStream(sourceUrl, context).pipe(
      Effect.map((stream) => Response.json(stream)),
      Effect.catchTag("SoundCloudStreamError", (error) =>
        Effect.sync(() => {
          if (!isUnreportedCode(error.code)) {
            reportDownloadFailure({
              route: "soundcloud_stream",
              stage: `soundcloud.${error.stage}`,
              requestId: context.requestId,
              errorCode: error.code,
              sourceUrl,
              upstreamStatus: error.upstreamStatus,
            });
          }

          return errorResponse(error.code);
        }),
      ),
    ),
    { signal: event.req.signal },
  );

  result.headers.set("X-Tagium-Request-Id", context.requestId);

  return respond(result);
});
