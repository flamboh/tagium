import { defineHandler } from "nitro";
import { env as processEnv } from "node:process";
import {
  devFaultUpdateSchema,
  getDevControlSnapshot,
  isDevToolsEnabled,
  setDevFault,
  type CobaltRuntimeEnv,
} from "../../utils/dev-controls";
import { decodeRequestBody } from "../../utils/schema";

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

export default defineHandler(async (event) => {
  const runtimeEnv = getRuntimeEnv(event.req);
  if (!isDevToolsEnabled(event.req, runtimeEnv)) {
    return new Response("Not found.", { status: 404 });
  }

  const body = await decodeRequestBody(event.req, devFaultUpdateSchema);
  setDevFault(body);
  return Response.json(getDevControlSnapshot(event.req, runtimeEnv));
});
