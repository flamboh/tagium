import { defineHandler } from "nitro";
import { env as processEnv } from "node:process";
import {
  isCobaltMachineId,
  isValidCobaltMachineSignature,
} from "../../utils/cobalt-machine-affinity";

type CobaltRuntimeEnv = {
  COBALT_API_URL?: string;
  COBALT_MACHINE_AFFINITY_SECRET?: string;
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

const parseTunnelRequest = (request: Request, runtimeEnv: CobaltRuntimeEnv) => {
  const requestUrl = new URL(request.url);
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

  const cobaltUrl = new URL(getCobaltApiUrl(runtimeEnv));
  if (tunnelUrl.origin !== cobaltUrl.origin || tunnelUrl.pathname !== "/tunnel") {
    return undefined;
  }

  const machineId = requestUrl.searchParams.get("machine");
  const signature = requestUrl.searchParams.get("signature");
  if (machineId === null) {
    if (signature !== null) {
      return undefined;
    }

    return { tunnelUrl, machineId };
  }

  if (!isCobaltMachineId(machineId) || signature === null) {
    return undefined;
  }

  if (!isValidCobaltMachineSignature(runtimeEnv, tunnelUrlParam, machineId, signature)) {
    return undefined;
  }

  return { tunnelUrl, machineId };
};

export default defineHandler(async (event) => {
  try {
    const runtimeEnv = getRuntimeEnv(event.req);
    const tunnelRequest = parseTunnelRequest(event.req, runtimeEnv);
    if (!tunnelRequest) {
      return new Response("Invalid Cobalt tunnel URL.", { status: 400 });
    }

    const requestHeaders = new Headers();
    if (tunnelRequest.machineId) {
      requestHeaders.set("Fly-Force-Instance-Id", tunnelRequest.machineId);
    }

    const response = await fetch(tunnelRequest.tunnelUrl, {
      headers: requestHeaders,
      signal: AbortSignal.timeout(COBALT_TUNNEL_TIMEOUT_MS),
    });

    if (!response.ok) {
      return new Response(`Cobalt tunnel request failed (${response.status}).`, { status: 502 });
    }

    const body = await streamNonEmptyBody(response);
    if (!body) {
      return new Response("Cobalt tunnel response was empty.", { status: 502 });
    }

    const responseHeaders = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) {
      responseHeaders.set("Content-Type", contentType);
    }

    return new Response(body, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof Error) {
      return new Response(error.message, { status: 502 });
    }

    return new Response("Cobalt tunnel request failed.", { status: 502 });
  }
});
