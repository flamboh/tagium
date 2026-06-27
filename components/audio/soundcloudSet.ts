import { z } from "zod";
import { ImportedAlbumMetadata } from "./types";

const soundCloudSetSchema = z.object({
  title: z.string(),
  artist: z.string(),
  genre: z.string(),
  year: z.number().optional(),
  coverUrl: z.string().optional(),
  tracks: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      duration: z.number().optional(),
      trackNumber: z.number(),
    }),
  ),
});

export type SoundCloudSet = z.infer<typeof soundCloudSetSchema>;

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

export const resolveSoundCloudSet = async (url: string) => {
  const endpoint = new URL("/api/soundcloud-set", window.location.origin);
  endpoint.searchParams.set("url", url);

  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`soundcloud set request failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    throw new Error("soundcloud set route returned non-json. restart tagium dev server.");
  }

  return soundCloudSetSchema.parse(await response.json());
};

export const toImportedAlbumMetadata = (set: SoundCloudSet): ImportedAlbumMetadata => ({
  title: set.title,
  artist: set.artist,
  genre: set.genre,
  year: set.year,
  coverUrl: set.coverUrl,
});
