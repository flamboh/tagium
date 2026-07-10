export type CloudflareRateLimitBinding = {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
};

export type CobaltRequestAdmissionDecision =
  | { status: "allowed"; setCookie?: string }
  | { status: "limited"; scope: "session" | "client"; setCookie?: string }
  | { status: "unavailable"; setCookie?: string };

export interface CobaltRequestAdmission {
  admit: (request: Request) => Promise<CobaltRequestAdmissionDecision>;
}

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

export const createCloudflareCobaltRequestAdmission = ({
  sessionLimiter,
  clientLimiter,
}: {
  sessionLimiter: CloudflareRateLimitBinding;
  clientLimiter: CloudflareRateLimitBinding;
}): CobaltRequestAdmission => ({
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

export const createInMemoryCobaltRequestAdmission = (
  enforce: (request: Request) => Response | undefined,
): CobaltRequestAdmission => ({
  admit: async (request) =>
    enforce(request) ? { status: "limited", scope: "client" } : { status: "allowed" },
});
