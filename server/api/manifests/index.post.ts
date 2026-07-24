import { defineHandler } from "nitro";
import {
  isShareManifestValidationError,
  parseShareArtwork,
  SHARE_ARTWORK_MAX_BYTES,
  SHARE_MANIFEST_MAX_BYTES,
} from "../../utils/share-manifest";
import {
  admitShareCreate,
  badRequest,
  decodePublishedManifest,
  getShareStore,
  infrastructureFailure,
  isSameOriginBrowserRequest,
  noStore,
  readRequestBodyWithinLimit,
} from "../../utils/share-manifest-request";
import { toShareExpiryIso } from "../../../src/features/share/shareManifest";

const MAX_SHARE_REQUEST_BYTES = SHARE_MANIFEST_MAX_BYTES + SHARE_ARTWORK_MAX_BYTES + 64 * 1024;

export default defineHandler(async (event) => {
  const request = event.req;
  if (!(await admitShareCreate(request)))
    return new Response(null, { status: 429, headers: noStore });
  if (!isSameOriginBrowserRequest(request)) return badRequest();
  const store = getShareStore(request);
  if (!store) return infrastructureFailure();
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) return badRequest();

  try {
    const body = await readRequestBodyWithinLimit(request, MAX_SHARE_REQUEST_BYTES);
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    }).formData();
    const entries = [...form.entries()];
    if (entries.some(([name]) => name !== "manifest" && name !== "cover")) return badRequest();
    const manifests = form.getAll("manifest");
    const covers = form.getAll("cover");
    if (
      manifests.length !== 1 ||
      covers.length > 1 ||
      typeof manifests[0] !== "string" ||
      (covers[0] !== undefined && !(covers[0] instanceof File))
    )
      return badRequest();
    const rawManifest = manifests[0];
    const manifest = decodePublishedManifest(JSON.parse(rawManifest));
    const published = await store.publish(
      manifest,
      await parseShareArtwork(covers[0] as File | undefined),
    );
    const url = new URL(`/share/${published.slug}`, request.url).toString();
    return Response.json(
      { ...published, expiresAt: toShareExpiryIso(published.expiresAt), url },
      { status: 201, headers: noStore },
    );
  } catch (error) {
    if (
      isShareManifestValidationError(error) ||
      error instanceof SyntaxError ||
      error instanceof TypeError ||
      (error instanceof Error && /^share_request_too_large|manifest payload/.test(error.message))
    )
      return badRequest();
    // The service deliberately returns no diagnostic payload for binding/storage failures.
    return infrastructureFailure();
  }
});
