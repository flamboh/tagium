import { Schema } from "effect";
import type { ImportedAlbumMetadata } from "./types";

const urlStringSchema = Schema.String.pipe(
  Schema.refine((value): value is string => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }),
);

const soundCloudSetTrackSchema = Schema.Struct({
  title: Schema.String,
  url: urlStringSchema,
  duration: Schema.optionalKey(Schema.Number),
  trackNumber: Schema.Number,
});

const soundCloudSetSchema = Schema.Struct({
  title: Schema.String,
  artist: Schema.String,
  genre: Schema.String,
  year: Schema.optionalKey(Schema.Number),
  isAlbum: Schema.Boolean,
  coverUrl: Schema.optionalKey(Schema.String),
  tracks: Schema.Array(soundCloudSetTrackSchema),
});

const decodeSoundCloudSet = Schema.decodeUnknownSync(soundCloudSetSchema);

export type SoundCloudSet = Schema.Schema.Type<typeof soundCloudSetSchema>;

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

  return decodeSoundCloudSet(await response.json());
};

export const toImportedAlbumMetadata = (set: SoundCloudSet): ImportedAlbumMetadata => ({
  title: set.title,
  artist: set.artist,
  genre: set.genre,
  year: set.year,
  coverUrl: set.coverUrl,
});
