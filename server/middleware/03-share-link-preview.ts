import { defineMiddleware } from "nitro";
import { toResponse } from "nitro/h3";
import { SHARE_SLUG_PATTERN } from "../../src/features/share/shareSlug";
import { admitShareRead, getShareStore } from "../utils/share-manifest-request";
import {
  buildShareLinkPreviewMetadata,
  injectShareLinkPreview,
  type ShareLinkPreviewMetadata,
} from "../utils/share-link-preview";

type LoadShareLinkPreview = (
  request: Request,
  slug: string,
) => Promise<ShareLinkPreviewMetadata | undefined>;

const loadShareLinkPreview: LoadShareLinkPreview = async (request, slug) => {
  if (!(await admitShareRead(request))) return undefined;
  const store = getShareStore(request);
  if (!store) return undefined;
  const result = await store.load(slug);
  return result.kind === "available"
    ? buildShareLinkPreviewMetadata(result.manifest, slug, request.url)
    : undefined;
};

export const createShareLinkPreviewMiddleware = (loadPreview: LoadShareLinkPreview) =>
  defineMiddleware(async (event, next) => {
    if (event.req.method !== "GET") return next();
    const match = new URL(event.req.url).pathname.match(/^\/share\/([^/]+)\/?$/);
    const slug = match?.[1] ?? "";
    if (!SHARE_SLUG_PATTERN.test(slug)) return next();

    const [response, metadata] = await Promise.all([
      toResponse(next(), event),
      loadPreview(event.req, slug).catch(() => undefined),
    ]);
    if (!metadata || !response.headers.get("content-type")?.startsWith("text/html")) {
      return response;
    }

    const html = await response.text();
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("cache-control", "no-store");
    return new Response(injectShareLinkPreview(html, metadata), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });

export default createShareLinkPreviewMiddleware(loadShareLinkPreview);
