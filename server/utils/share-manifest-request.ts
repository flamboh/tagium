import { admitShareRequest, type ShareRateLimitBinding } from "./share-manifest-rate-limit";
import {
  createCloudflareShareManifestPersistence,
  type D1DatabaseBinding,
  type R2BucketBinding,
} from "./share-manifest-cloudflare";
import {
  createShareManifestStore,
  ShareManifestValidationError,
  type ShareManifest,
} from "./share-manifest";
import { decodeManifest } from "../../src/features/share/shareManifest";

export type ShareRuntimeEnv = {
  SHARE_MANIFESTS?: D1DatabaseBinding;
  SHARE_ARTWORK?: R2BucketBinding;
  SHARE_CREATE_RATE_LIMITER?: ShareRateLimitBinding;
  SHARE_READ_RATE_LIMITER?: ShareRateLimitBinding;
  SHARE_REVOKE_RATE_LIMITER?: ShareRateLimitBinding;
};

type CloudflareRequest = Request & { runtime?: { cloudflare?: { env?: ShareRuntimeEnv } } };

export const getShareRuntimeEnv = (request: Request): ShareRuntimeEnv =>
  (request as CloudflareRequest).runtime?.cloudflare?.env ?? {};

export const getShareStore = (request: Request) => {
  const env = getShareRuntimeEnv(request);
  if (!env.SHARE_MANIFESTS || !env.SHARE_ARTWORK) return undefined;
  return createShareManifestStore(
    createCloudflareShareManifestPersistence({
      database: env.SHARE_MANIFESTS,
      artwork: env.SHARE_ARTWORK,
    }),
  );
};

export const admitShareCreate = (request: Request) =>
  admitShareRequest(request, getShareRuntimeEnv(request).SHARE_CREATE_RATE_LIMITER);

export const admitShareRead = (request: Request) =>
  admitShareRequest(request, getShareRuntimeEnv(request).SHARE_READ_RATE_LIMITER);

export const admitShareRevoke = (request: Request) =>
  admitShareRequest(request, getShareRuntimeEnv(request).SHARE_REVOKE_RATE_LIMITER);

/** The shared transport contract is the sole source/SSRF validation policy. */
export const decodePublishedManifest = (value: unknown): ShareManifest => {
  try {
    return decodeManifest(value);
  } catch {
    throw new ShareManifestValidationError("share_manifest_invalid");
  }
};

export const noStore = { "Cache-Control": "no-store" };
export const unavailable = () => new Response(null, { status: 404, headers: noStore });
export const badRequest = () => new Response(null, { status: 400, headers: noStore });
export const infrastructureFailure = () => new Response(null, { status: 503, headers: noStore });

export const isSameOriginBrowserRequest = (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite !== "cross-site" && fetchSite !== "same-site";
};

export const readRequestBodyWithinLimit = async (request: Request, maximumBytes: number) => {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    throw new Error("share_request_too_large");
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximumBytes) throw new Error("share_request_too_large");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};
