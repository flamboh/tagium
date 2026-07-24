export type RequestLogContext = {
  requestId: string;
  importId?: string;
  trackIndex?: number;
  url?: string;
};

const correlationIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

const getCorrelationHeader = (request: Request, name: string) => {
  const value = request.headers.get(name);
  return value && correlationIdPattern.test(value) ? value : undefined;
};

export const getRequestLogContext = (request: Request, url?: string): RequestLogContext => {
  const requestId =
    getCorrelationHeader(request, "x-tagium-request-id") ??
    getCorrelationHeader(request, "x-request-id") ??
    crypto.randomUUID();
  const importId = getCorrelationHeader(request, "x-tagium-import-id");
  const rawTrackIndex = request.headers.get("x-tagium-track-index");
  const trackIndex =
    rawTrackIndex && /^\d{1,5}$/.test(rawTrackIndex) ? Number(rawTrackIndex) : undefined;
  return { requestId, importId, trackIndex, url };
};

export const fingerprintUrl = async (value: string | URL | undefined) => {
  if (!value) return undefined;
  const normalized = new URL(value);
  normalized.hash = "";
  normalized.hostname = normalized.hostname.toLowerCase();
  normalized.searchParams.sort();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized.toString()),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `sha256:${hex.slice(0, 32)}`;
};
