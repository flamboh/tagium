import { decodePlaylist, type Playlist } from "@/features/import/playlist";
import { parseMediaLink } from "@/lib/media-link";

export type YouTubePlaylist = Playlist;

export const isYouTubePlaylistUrl = (url: string) =>
  parseMediaLink(url).provider === "youtube" && parseMediaLink(url).kind === "playlist";

export const resolveYouTubePlaylist = async (url: string) => {
  const endpoint = new URL("/api/youtube-playlist", window.location.origin);
  endpoint.searchParams.set("url", url);

  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`youtube playlist request failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    throw new Error("youtube playlist route returned non-json. restart tagium dev server.");
  }

  return decodePlaylist(await response.json(), "YouTube");
};
