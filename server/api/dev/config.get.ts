import { defineHandler } from "nitro";
import { env as processEnv } from "node:process";
import {
  getDevControlSnapshot,
  isDevToolsEnabled,
  type CobaltRuntimeEnv,
} from "../../utils/dev-controls";

type CloudflareRequest = Request & {
  runtime?: {
    cloudflare?: {
      env?: CobaltRuntimeEnv;
    };
  };
};

const getRuntimeEnv = (request: Request): CobaltRuntimeEnv => ({
  ...processEnv,
  ...(request as CloudflareRequest).runtime?.cloudflare?.env,
});

export default defineHandler((event) => {
  const runtimeEnv = getRuntimeEnv(event.req);
  if (!isDevToolsEnabled(event.req, runtimeEnv)) {
    return new Response("Not found.", { status: 404 });
  }

  return Response.json(getDevControlSnapshot(event.req, runtimeEnv));
});
