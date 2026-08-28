import { defineHandler } from "nitro";
import { Schema } from "effect";
import {
  isShareManifestValidationError,
  parseShareArtwork,
  SHARE_ARTWORK_MAX_BYTES,
  SHARE_MANIFEST_MAX_BYTES,
  type ShareArtworkUpdate,
} from "../../utils/share-manifest";
import {
  admitShareUpdate,
  badRequest,
  decodePublishedManifest,
  getShareStore,
  infrastructureFailure,
  isSameOriginBrowserRequest,
  noStore,
  readRequestBodyWithinLimit,
  unavailable,
} from "../../utils/share-manifest-request";
import { toShareExpiryIso } from "../../../src/features/share/shareManifest";

const MAX_SHARE_REQUEST_BYTES = SHARE_MANIFEST_MAX_BYTES + SHARE_ARTWORK_MAX_BYTES + 64 * 1024;
const MAX_REVOCATION_TOKEN_LENGTH = 128;

export default defineHandler(async (event) => {
  const request = event.req;
  if (!(await admitShareUpdate(request)))
    return new Response(null, { status: 429, headers: noStore });
  if (!isSameOriginBrowserRequest(request)) return badRequest();
  const store = getShareStore(request);
  if (!store) return infrastructureFailure();
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token || token.length > MAX_REVOCATION_TOKEN_LENGTH) return unavailable();
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
    if (
      entries.some(([name]) => name !== "manifest" && name !== "cover" && name !== "removeArtwork")
    )
      return badRequest();
    const manifests = form.getAll("manifest");
    const covers = form.getAll("cover");
    const removals = form.getAll("removeArtwork");
    if (
      manifests.length !== 1 ||
      covers.length > 1 ||
      removals.length > 1 ||
      !Schema.is(Schema.String)(manifests[0]) ||
      (covers[0] !== undefined && !(covers[0] instanceof File)) ||
      (removals[0] !== undefined && removals[0] !== "true") ||
      (covers.length > 0 && removals.length > 0)
    )
      return badRequest();
    let artworkUpdate: ShareArtworkUpdate = { kind: "retain" };
    if (removals.length > 0) {
      artworkUpdate = { kind: "remove" };
    } else if (covers[0] instanceof File) {
      const artwork = await parseShareArtwork(covers[0]);
      if (!artwork) return badRequest();
      artworkUpdate = { kind: "replace", artwork };
    }
    const result = await store.update(
      event.context.params?.slug ?? "",
      token,
      decodePublishedManifest(JSON.parse(manifests[0])),
      artworkUpdate,
    );
    if (result.kind === "unavailable") return unavailable();
    return Response.json(
      {
        slug: result.slug,
        expiresAt: toShareExpiryIso(result.expiresAt),
        url: new URL(`/share/${result.slug}`, request.url).toString(),
        analyticsId: result.analyticsId,
      },
      { headers: noStore },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (isShareManifestValidationError(error) ||
        error instanceof SyntaxError ||
        error instanceof TypeError ||
        /^share_request_too_large|manifest payload/.test(error.message))
    )
      return badRequest();
    return infrastructureFailure();
  }
});
