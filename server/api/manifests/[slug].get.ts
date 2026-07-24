import { defineHandler } from "nitro";
import {
  admitShareRead,
  getShareStore,
  noStore,
  unavailable,
} from "../../utils/share-manifest-request";
import { infrastructureFailure } from "../../utils/share-manifest-request";
import { toShareExpiryIso } from "../../../src/features/share/shareManifest";

export default defineHandler(async (event) => {
  const request = event.req;
  if (!(await admitShareRead(request)))
    return new Response(null, { status: 429, headers: noStore });
  const store = getShareStore(request);
  if (!store) return infrastructureFailure();
  try {
    const result = await store.load(event.context.params?.slug ?? "");
    return result.kind === "available"
      ? Response.json(
          { manifest: result.manifest, expiresAt: toShareExpiryIso(result.expiresAt) },
          { headers: noStore },
        )
      : unavailable();
  } catch {
    return infrastructureFailure();
  }
});
