import { defineHandler } from "nitro";
import { getSoundCloudLogContext } from "../utils/soundcloud-observability";
import { resolveSoundCloudSet } from "../utils/soundcloud-set";

export default defineHandler(async (event) => {
  const requestUrl = new URL(event.req.url, "http://tagium.local");
  const sourceUrl = requestUrl.searchParams.get("url");

  if (!sourceUrl) {
    throw new Error("soundcloud.url_required");
  }
  return resolveSoundCloudSet(sourceUrl, getSoundCloudLogContext(event.req, sourceUrl));
});
