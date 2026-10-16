import { defineHandler, HTTPError } from "nitro";
import { resolveSoundCloudShortLink } from "../utils/soundcloud-link";

export default defineHandler(async (event) => {
  const input = new URL(event.req.url, "http://tagium.local").searchParams.get("url");

  if (!input) throw new Error("soundcloud.url_required");

  try {
    return await resolveSoundCloudShortLink(input, { signal: event.req.signal });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("soundcloud.short.")) {
      throw new HTTPError({ status: 422, message: error.message });
    }

    throw error;
  }
});
