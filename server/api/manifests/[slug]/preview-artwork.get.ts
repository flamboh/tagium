import { defineHandler } from "nitro";
import { isShareArtworkBytes } from "../../../utils/share-manifest";
import { admitShareRead, getShareStore, noStore } from "../../../utils/share-manifest-request";

const fallback = (request: Request) =>
  new Response(null, {
    status: 302,
    headers: {
      ...noStore,
      Location: new URL("/icon-512.png", request.url).href,
    },
  });

/** Serves crawler artwork while guaranteeing a valid branded image on every failure path. */
export default defineHandler(async (event) => {
  const request = event.req;
  if (!(await admitShareRead(request))) return fallback(request);

  const store = getShareStore(request);
  if (!store) return fallback(request);

  try {
    const result = await store.loadArtwork(event.context.params?.slug ?? "");
    if (result.kind !== "available") return fallback(request);

    const bytes = new Uint8Array(await new Response(result.artwork.body).arrayBuffer());
    if (
      (result.artwork.type !== "image/jpeg" && result.artwork.type !== "image/png") ||
      !isShareArtworkBytes(bytes, result.artwork.type)
    ) {
      return fallback(request);
    }
    const headers = new Headers(noStore);
    headers.set("Content-Type", result.artwork.type);
    headers.set("Content-Length", String(bytes.byteLength));
    if (result.artwork.sha256) headers.set("ETag", `"${result.artwork.sha256}"`);
    return new Response(bytes, { headers });
  } catch {
    return fallback(request);
  }
});
