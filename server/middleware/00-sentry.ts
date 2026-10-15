import { wrapRequestHandler } from "@sentry/cloudflare";
import { defineMiddleware } from "nitro";
import { toResponse } from "nitro/h3";

type SentryRuntimeRequest = Request & {
  runtime?: {
    cloudflare?: {
      env?: { SENTRY_DSN?: string; TAGIUM_DEPLOY_ENV?: string };
      context?: Parameters<typeof wrapRequestHandler>[0]["context"];
    };
  };
};

export default defineMiddleware((event, next) => {
  const { pathname } = new URL(event.req.url);

  if (!pathname.startsWith("/api/cobalt/") && pathname !== "/api/soundcloud-stream") return next();

  // SAFETY: Nitro's Cloudflare adapter supplies this request shape in the Cloudflare runtime.
  const cloudflare = (event.req as SentryRuntimeRequest).runtime?.cloudflare;
  const dsn = cloudflare?.env?.SENTRY_DSN;

  if (!dsn) return next();

  return wrapRequestHandler(
    {
      options: {
        dsn,
        environment: cloudflare.env?.TAGIUM_DEPLOY_ENV ?? "unknown",
        defaultIntegrations: false,
        sendDefaultPii: false,
      },
      request: event.req,
      context: cloudflare.context,
    },
    () => toResponse(next(), event),
  );
});
