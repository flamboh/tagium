import {
  enforceRateLimit,
  getDeployEnv,
  type CobaltRuntimeEnv as DevControlRuntimeEnv,
} from "./dev-controls";

export type CloudflareRateLimitBinding = {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
};

export type DownloadRequestAdmissionDecision =
  | { status: "allowed"; setCookie?: string }
  | { status: "limited"; scope: "session" | "client"; setCookie?: string }
  | { status: "unavailable"; setCookie?: string };

export interface DownloadRequestAdmission {
  admit: (request: Request) => Promise<DownloadRequestAdmissionDecision>;
}

export type CobaltAdmissionRuntimeEnv = {
  COBALT_CLIENT_RATE_LIMITER?: CloudflareRateLimitBinding;
  COBALT_SESSION_RATE_LIMITER?: CloudflareRateLimitBinding;
} & DevControlRuntimeEnv;

export type SoundCloudAdmissionRuntimeEnv = {
  SOUNDCLOUD_CLIENT_RATE_LIMITER?: CloudflareRateLimitBinding;
  SOUNDCLOUD_SESSION_RATE_LIMITER?: CloudflareRateLimitBinding;
} & DevControlRuntimeEnv;

const SESSION_COOKIE_NAME = "tagium_client_id";

const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const SESSION_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const readCookie = (request: Request, name: string) => {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) return undefined;

  for (const entry of cookieHeader.split(";")) {
    const separatorIndex = entry.indexOf("=");

    if (separatorIndex < 0) continue;
    const entryName = entry.slice(0, separatorIndex).trim();

    if (entryName !== name) continue;
    const value = entry.slice(separatorIndex + 1).trim();

    if (SESSION_KEY_PATTERN.test(value)) return value;
  }

  return undefined;
};

const getSessionIdentity = (request: Request) => {
  const existingKey = readCookie(request, SESSION_COOKIE_NAME);

  if (existingKey) return { key: existingKey };

  const key = crypto.randomUUID();

  return {
    key,
    setCookie: `${SESSION_COOKIE_NAME}=${key}; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
  };
};

const getClientKey = (request: Request) =>
  request.headers.get("cf-connecting-ip") || "unknown-client";

export const createCloudflareDownloadRequestAdmission = ({
  sessionLimiter,
  clientLimiter,
}: {
  sessionLimiter: CloudflareRateLimitBinding;
  clientLimiter: CloudflareRateLimitBinding;
}): DownloadRequestAdmission => ({
  admit: async (request) => {
    const session = getSessionIdentity(request);

    try {
      const [sessionResult, clientResult] = await Promise.all([
        sessionLimiter.limit({ key: session.key }),
        clientLimiter.limit({ key: getClientKey(request) }),
      ]);

      if (!clientResult.success) {
        return { status: "limited", scope: "client", setCookie: session.setCookie };
      }

      if (!sessionResult.success) {
        return { status: "limited", scope: "session", setCookie: session.setCookie };
      }

      return { status: "allowed", setCookie: session.setCookie };
    } catch {
      return { status: "unavailable", setCookie: session.setCookie };
    }
  },
});

export const createInMemoryDownloadRequestAdmission = (
  enforce: (request: Request) => Response | undefined,
): DownloadRequestAdmission => ({
  admit: async (request) =>
    enforce(request) ? { status: "limited", scope: "client" } : { status: "allowed" },
});

/** Uses Tagium's provisioned admission policy in deployed environments and its dev policy locally. */
const getDownloadRequestAdmission = (
  request: Request,
  runtimeEnv: DevControlRuntimeEnv,
  sessionLimiter: CloudflareRateLimitBinding | undefined,
  clientLimiter: CloudflareRateLimitBinding | undefined,
): DownloadRequestAdmission | undefined => {
  if (sessionLimiter && clientLimiter) {
    return createCloudflareDownloadRequestAdmission({ sessionLimiter, clientLimiter });
  }

  return getDeployEnv(request, runtimeEnv).deployEnv === "local"
    ? createInMemoryDownloadRequestAdmission(enforceRateLimit)
    : undefined;
};

export const getCobaltRequestAdmission = (
  request: Request,
  runtimeEnv: CobaltAdmissionRuntimeEnv,
) =>
  getDownloadRequestAdmission(
    request,
    runtimeEnv,
    runtimeEnv.COBALT_SESSION_RATE_LIMITER,
    runtimeEnv.COBALT_CLIENT_RATE_LIMITER,
  );

export const getSoundCloudRequestAdmission = (
  request: Request,
  runtimeEnv: SoundCloudAdmissionRuntimeEnv,
) =>
  getDownloadRequestAdmission(
    request,
    runtimeEnv,
    runtimeEnv.SOUNDCLOUD_SESSION_RATE_LIMITER,
    runtimeEnv.SOUNDCLOUD_CLIENT_RATE_LIMITER,
  );
