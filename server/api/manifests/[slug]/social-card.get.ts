import { defineHandler } from "nitro";
import { manifestArtwork } from "../../../../src/features/share/shareManifest";
import {
  admitShareRead,
  getShareStore,
  infrastructureFailure,
  noStore,
  unavailable,
} from "../../../utils/share-manifest-request";
import {
  renderShareSocialCardPng,
  type ShareSocialCardArtwork,
} from "../../../utils/share-social-card";

type RenderShareSocialCard = typeof renderShareSocialCardPng;

export const createShareSocialCardHandler = (renderSocialCard: RenderShareSocialCard) =>
  defineHandler(async (event) => {
    const request = event.req;
    if (!(await admitShareRead(request))) {
      return new Response(null, { status: 429, headers: noStore });
    }
    const store = getShareStore(request);
    if (!store) return infrastructureFailure();

    try {
      const slug = event.context.params?.slug ?? "";
      const manifestResult = await store.load(slug);
      if (manifestResult.kind !== "available") return unavailable();

      const artworkResult = manifestArtwork(manifestResult.manifest)
        ? await store.loadArtwork(slug)
        : undefined;
      let artwork: ShareSocialCardArtwork | undefined;
      if (
        artworkResult?.kind === "available" &&
        (artworkResult.artwork.type === "image/jpeg" || artworkResult.artwork.type === "image/png")
      ) {
        artwork = {
          bytes: new Uint8Array(await new Response(artworkResult.artwork.body).arrayBuffer()),
          type: artworkResult.artwork.type,
        };
      }
      const png = await renderSocialCard(manifestResult.manifest, artwork);
      return new Response(Uint8Array.from(png).buffer, {
        headers: {
          ...noStore,
          "Content-Type": "image/png",
          "Content-Length": String(png.byteLength),
        },
      });
    } catch {
      return infrastructureFailure();
    }
  });

export default createShareSocialCardHandler(renderShareSocialCardPng);
