import { decodePlaylist, type Playlist } from "@/features/import/playlist";

export type SoundCloudSet = Playlist;

export const isSoundCloudSetUrl = (url: string) => {
  try {
    const parsedUrl = new URL(url);
    const isSoundCloudHost =
      parsedUrl.hostname === "soundcloud.com" || parsedUrl.hostname.endsWith(".soundcloud.com");
    return isSoundCloudHost && parsedUrl.pathname.includes("/sets/");
  } catch {
    return false;
  }
};

export const resolveSoundCloudSet = async (url: string, importId?: string) => {
  const endpoint = new URL("/api/soundcloud-set", window.location.origin);
  endpoint.searchParams.set("url", url);

  const headers = new Headers();
  headers.set("X-Tagium-Request-Id", crypto.randomUUID());
  if (importId) {
    headers.set("X-Tagium-Import-Id", importId);
  }
  const response = await fetch(endpoint, { headers });
  if (!response.ok) {
    throw new Error(`soundcloud set request failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    throw new Error("soundcloud set route returned non-json. restart tagium dev server.");
  }

  return decodePlaylist(await response.json(), "SoundCloud");
};
