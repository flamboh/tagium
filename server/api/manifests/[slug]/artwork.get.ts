import { defineHandler } from "nitro";
import {
  admitShareRead,
  getShareStore,
  infrastructureFailure,
  noStore,
  unavailable,
} from "../../../utils/share-manifest-request";

export default defineHandler(async (event) => {
  const request = event.req;
  if (!(await admitShareRead(request)))
    return new Response(null, { status: 429, headers: noStore });
  const store = getShareStore(request);
  if (!store) return infrastructureFailure();
  let result;
  try {
    result = await store.loadArtwork(event.context.params?.slug ?? "");
  } catch {
    return infrastructureFailure();
  }
  if (result.kind !== "available") return unavailable();
  const headers = new Headers(noStore);
  headers.set("Content-Type", result.artwork.type);
  headers.set("Content-Length", String(result.artwork.size));
  if (result.artwork.sha256) headers.set("ETag", `"${result.artwork.sha256}"`);
  return new Response(result.artwork.body, { headers });
});
