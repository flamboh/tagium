import { Effect, Schema } from "effect";
import { defineHandler } from "nitro";
import { env as processEnv } from "node:process";
import {
  getLyricsRequestAdmission,
  type LyricsAdmissionRuntimeEnv,
} from "../utils/download-request-admission";
import { lookupLyrics } from "../utils/lrclib";
import { enforceSameOrigin } from "../utils/same-origin";
import { decodeRequestBody } from "../utils/schema";

type LyricsRuntimeEnv = {
  COBALT_ALLOWED_ORIGIN?: string;
  LRCLIB_APP_ID?: string;
  LRCLIB_API_KEY?: string;
} & LyricsAdmissionRuntimeEnv;

type CloudflareRequest = Request & {
  runtime?: { cloudflare?: { env?: LyricsRuntimeEnv } };
};

const nonEmptyText = Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(500));

const lyricsRequestSchema = Schema.Struct({
  title: nonEmptyText,
  artist: nonEmptyText,
  album: Schema.optionalKey(Schema.Trim.check(Schema.isMaxLength(500))),
  duration: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 86_400 })),
});

const getRuntimeEnv = (request: Request): LyricsRuntimeEnv => ({
  ...processEnv,
  // SAFETY: Nitro's Cloudflare adapter supplies this request shape in the Cloudflare runtime.
  ...(request as CloudflareRequest).runtime?.cloudflare?.env,
});

const busy = (retryAfterSeconds: number, message = "lyrics.busy") =>
  new Response(message, {
    status: 503,
    headers: { "Retry-After": String(Math.ceil(retryAfterSeconds)) },
  });

export default defineHandler(async (event) => {
  const runtimeEnv = getRuntimeEnv(event.req);
  const forbidden = enforceSameOrigin(event.req, runtimeEnv.COBALT_ALLOWED_ORIGIN);

  if (forbidden) return forbidden;

  const { LRCLIB_APP_ID: appId, LRCLIB_API_KEY: apiKey } = runtimeEnv;

  if (!appId || !apiKey) return new Response("lyrics.unconfigured", { status: 501 });

  const body = await decodeRequestBody(event.req, lyricsRequestSchema);
  const admission = getLyricsRequestAdmission(event.req, runtimeEnv);

  if (!admission) return busy(2, "lyrics.admission_unavailable");

  const decision = await admission.admit(event.req);

  const respond = (response: Response) => {
    if (decision.setCookie) response.headers.append("Set-Cookie", decision.setCookie);

    return response;
  };

  if (decision.status === "unavailable") return respond(busy(2, "lyrics.admission_unavailable"));

  if (decision.status === "limited") {
    return respond(
      new Response("lyrics.rate_limited", { status: 429, headers: { "Retry-After": "10" } }),
    );
  }

  const response = await Effect.runPromise(
    lookupLyrics({ appId, apiKey }, body).pipe(
      Effect.map((lookup) => Response.json(lookup)),
      Effect.catchTag("LrclibBusyError", (error) => Effect.succeed(busy(error.retryAfterSeconds))),
      Effect.catchTag("LrclibRequestError", (error) =>
        Effect.sync(() => {
          console.warn(
            JSON.stringify({
              event: "lyrics_lookup_failure",
              upstreamStatus: error.status,
              message: error.cause instanceof Error ? error.cause.message : undefined,
            }),
          );

          return new Response("lyrics.upstream_failed", { status: 502 });
        }),
      ),
    ),
    { signal: event.req.signal },
  );

  return respond(response);
});
