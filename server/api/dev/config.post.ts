import { defineHandler } from "nitro";
import { env as processEnv } from "node:process";
import {
  devConfigUpdateSchema,
  getDevControlSnapshot,
  isDevToolsEnabled,
  updateDevConfig,
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

  const body = await decodeRequestBody(event.req, devConfigUpdateSchema);
  updateDevConfig(body);
  return Response.json(getDevControlSnapshot(event.req, runtimeEnv));
});
