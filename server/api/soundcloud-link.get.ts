import { defineHandler } from "nitro";
import { resolveSoundCloudShortLink } from "../utils/soundcloud-link";

export default defineHandler(async (event) => {
  const input = new URL(event.req.url, "http://tagium.local").searchParams.get("url");
  if (!input) throw new Error("soundcloud.url_required");
  return resolveSoundCloudShortLink(input, { signal: event.req.signal });
});
