import { defineHandler } from "nitro";
import { env as processEnv } from "node:process";

type CobaltRuntimeEnv = {
  COBALT_API_URL?: string;
};

type CloudflareRequest = Request & {
  runtime?: {
    cloudflare?: {
      env?: CobaltRuntimeEnv;
    };
  };
};

const COBALT_TUNNEL_TIMEOUT_MS = 300_000;

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

const streamNonEmptyBody = async (response: Response) => {
  const reader = response.body?.getReader();
  if (!reader) {
    return undefined;
  }

  const firstChunk = await reader.read();
  if (firstChunk.done) {
    return undefined;
  }

  return new ReadableStream({
    start(controller) {
      controller.enqueue(firstChunk.value);
    },
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }

      controller.enqueue(chunk.value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
};

const parseTunnelUrl = (request: Request, runtimeEnv: CobaltRuntimeEnv) => {
  const requestUrl = new URL(request.url);
  const tunnelUrlParam = requestUrl.searchParams.get("url");
  if (!tunnelUrlParam) {
    return undefined;
  }

  const tunnelUrl = new URL(tunnelUrlParam);
  const cobaltUrl = new URL(getCobaltApiUrl(runtimeEnv));
  if (tunnelUrl.origin !== cobaltUrl.origin || tunnelUrl.pathname !== "/tunnel") {
    return undefined;
  }

  return tunnelUrl;
};

export default defineHandler(async (event) => {
  try {
    const runtimeEnv = getRuntimeEnv(event.req);
    const tunnelUrl = parseTunnelUrl(event.req, runtimeEnv);
    if (!tunnelUrl) {
      return new Response("Invalid Cobalt tunnel URL.", { status: 400 });
    }

    const response = await fetch(tunnelUrl, {
      signal: AbortSignal.timeout(COBALT_TUNNEL_TIMEOUT_MS),
    });

    if (!response.ok) {
      return new Response(`Cobalt tunnel request failed (${response.status}).`, { status: 502 });
    }

    const body = await streamNonEmptyBody(response);
    if (!body) {
      return new Response("Cobalt tunnel response was empty.", { status: 502 });
    }

    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) {
      headers.set("Content-Type", contentType);
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength && contentLength !== "0") {
      headers.set("Content-Length", contentLength);
    }

    return new Response(body, { headers });
  } catch (error) {
    if (error instanceof Error) {
      return new Response(error.message, { status: 502 });
    }

    return new Response("Cobalt tunnel request failed.", { status: 502 });
  }
});
