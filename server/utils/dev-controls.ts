import { z } from "zod";

export type CobaltRuntimeEnv = {
  CF_PAGES?: string;
  CF_PAGES_BRANCH?: string;
  NODE_ENV?: string;
  TAGIUM_DEPLOY_ENV?: string;
  TAGIUM_PRODUCTION_BRANCH?: string;
};

export type DeployEnv = "local" | "preview" | "production";
export type AudioDevFault = "rate-limit" | "capacity" | "timeout" | "unreachable" | "malformed";
export type TunnelDevFault = "rate-limit" | "capacity" | "timeout" | "empty-body";

type RateLimitBucket = {
  startedAt: number;
  count: number;
};

type DevState = {
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  nextAudioFault: AudioDevFault | undefined;
  nextTunnelFault: TunnelDevFault | undefined;
};

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 60;

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const devState: DevState = {
  rateLimitWindowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: DEFAULT_RATE_LIMIT_MAX_REQUESTS,
  nextAudioFault: undefined,
  nextTunnelFault: undefined,
};

export const devConfigUpdateSchema = z.object({
  rateLimit: z
    .object({
      windowMs: z.number().int().min(1_000).max(600_000),
      maxRequests: z.number().int().min(1).max(500),
    })
    .optional(),
  resetRateLimitBuckets: z.boolean().optional(),
});

export const devFaultUpdateSchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("audio"),
    fault: z.enum(["rate-limit", "capacity", "timeout", "unreachable", "malformed"]).nullable(),
  }),
  z.object({
    target: z.literal("tunnel"),
    fault: z.enum(["rate-limit", "capacity", "timeout", "empty-body"]).nullable(),
  }),
]);

export const getProductionBranch = (runtimeEnv: CobaltRuntimeEnv) =>
  runtimeEnv.TAGIUM_PRODUCTION_BRANCH || "main";

export const getRequestHostname = (request: Request) => {
  try {
    return new URL(request.url).hostname;
  } catch {
    return "";
  }
};

export const isLocalHostname = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

export const getDeployEnv = (
  request: Request,
  runtimeEnv: CobaltRuntimeEnv,
): { deployEnv: DeployEnv; detectedFrom: string } => {
  if (
    runtimeEnv.TAGIUM_DEPLOY_ENV === "local" ||
    runtimeEnv.TAGIUM_DEPLOY_ENV === "preview" ||
    runtimeEnv.TAGIUM_DEPLOY_ENV === "production"
  ) {
    return { deployEnv: runtimeEnv.TAGIUM_DEPLOY_ENV, detectedFrom: "TAGIUM_DEPLOY_ENV" };
  }

  const hostname = getRequestHostname(request);
  if (isLocalHostname(hostname) || runtimeEnv.NODE_ENV === "development") {
    return { deployEnv: "local", detectedFrom: "local runtime" };
  }

  if (runtimeEnv.CF_PAGES === "1") {
    const productionBranch = getProductionBranch(runtimeEnv);
    const branch = runtimeEnv.CF_PAGES_BRANCH;
    return {
      deployEnv: branch && branch !== productionBranch ? "preview" : "production",
      detectedFrom: "CF_PAGES_BRANCH",
    };
  }

  return { deployEnv: "production", detectedFrom: "default" };
};

export const isDevToolsEnabled = (request: Request, runtimeEnv: CobaltRuntimeEnv) =>
  getDeployEnv(request, runtimeEnv).deployEnv !== "production";

export const getClientKey = (request: Request) =>
  request.headers.get("cf-connecting-ip") || "unknown";

export const resetRateLimitBuckets = () => {
  rateLimitBuckets.clear();
};

export const updateDevConfig = (input: z.infer<typeof devConfigUpdateSchema>) => {
  if (input.rateLimit) {
    devState.rateLimitWindowMs = input.rateLimit.windowMs;
    devState.rateLimitMaxRequests = input.rateLimit.maxRequests;
  }

  if (input.resetRateLimitBuckets) {
    resetRateLimitBuckets();
  }
};

export const setDevFault = (input: z.infer<typeof devFaultUpdateSchema>) => {
  if (input.target === "audio") {
    devState.nextAudioFault = input.fault ?? undefined;
    return;
  }

  devState.nextTunnelFault = input.fault ?? undefined;
};

export const consumeAudioDevFault = (
  request: Request,
  runtimeEnv: CobaltRuntimeEnv,
): AudioDevFault | undefined => {
  if (!isDevToolsEnabled(request, runtimeEnv)) return undefined;

  const fault = devState.nextAudioFault;
  devState.nextAudioFault = undefined;
  return fault;
};

export const consumeTunnelDevFault = (
  request: Request,
  runtimeEnv: CobaltRuntimeEnv,
): TunnelDevFault | undefined => {
  if (!isDevToolsEnabled(request, runtimeEnv)) return undefined;

  const fault = devState.nextTunnelFault;
  devState.nextTunnelFault = undefined;
  return fault;
};

export const enforceRateLimit = (request: Request) => {
  const clientKey = getClientKey(request);
  const now = Date.now();
  const bucket = rateLimitBuckets.get(clientKey);

  if (!bucket || now - bucket.startedAt >= devState.rateLimitWindowMs) {
    rateLimitBuckets.set(clientKey, { startedAt: now, count: 1 });
    return undefined;
  }

  if (bucket.count >= devState.rateLimitMaxRequests) {
    return new Response("Download rate limit exceeded.", { status: 429 });
  }

  bucket.count += 1;
  return undefined;
};

export const getDevControlSnapshot = (request: Request, runtimeEnv: CobaltRuntimeEnv) => {
  const { deployEnv, detectedFrom } = getDeployEnv(request, runtimeEnv);
  const clientKey = getClientKey(request);
  const bucket = rateLimitBuckets.get(clientKey);
  const now = Date.now();
  const resetAt = bucket ? bucket.startedAt + devState.rateLimitWindowMs : undefined;
  const count = bucket && resetAt && resetAt > now ? bucket.count : 0;

  return {
    enabled: deployEnv !== "production",
    deployEnv,
    detectedFrom,
    productionBranch: getProductionBranch(runtimeEnv),
    rateLimit: {
      windowMs: devState.rateLimitWindowMs,
      maxRequests: devState.rateLimitMaxRequests,
      bucketCount: rateLimitBuckets.size,
      client: {
        key: clientKey,
        count,
        remaining: Math.max(devState.rateLimitMaxRequests - count, 0),
        resetAt,
      },
    },
    faults: {
      nextAudioFault: devState.nextAudioFault,
      nextTunnelFault: devState.nextTunnelFault,
    },
  };
};
