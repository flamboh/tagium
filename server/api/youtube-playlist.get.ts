import { defineHandler } from "nitro";
import { resolveYouTubePlaylist } from "../utils/youtube-playlist";

export default defineHandler(async (event) => {
  const requestUrl = new URL(event.req.url, "http://tagium.local");
  const sourceUrl = requestUrl.searchParams.get("url");
  if (!sourceUrl) throw new Error("youtube.url_required");
  return resolveYouTubePlaylist(sourceUrl, event.req.signal);
});
