import { Effect, Schema } from "effect";
import { defineHandler } from "nitro";
import { getSoundCloudClientId } from "../utils/soundcloud";
import { urlStringSchema } from "../utils/schema";

const nonEmptyStringSchema = Schema.String.check(Schema.isNonEmpty());

const oEmbedSchema = Schema.Struct({
  title: nonEmptyStringSchema,
  author_name: Schema.optionalKey(Schema.String),
  thumbnail_url: Schema.optionalKey(urlStringSchema),
});
const soundCloudTrackSchema = Schema.Struct({
  title: nonEmptyStringSchema,
  artwork_url: Schema.optionalKey(Schema.NullOr(urlStringSchema)),
  user: Schema.optionalKey(Schema.Struct({ username: Schema.optionalKey(Schema.String) })),
});

const isSoundCloudUrl = (url: URL) =>
  url.hostname === "soundcloud.com" || url.hostname.endsWith(".soundcloud.com");

export const resolveSoundCloudTrackMetadata = async (
  sourceUrl: string,
  options: {
    fetch?: typeof globalThis.fetch;
    getClientId?: () => Promise<string>;
    signal?: AbortSignal;
  } = {},
) => {
  const fetch = options.fetch ?? globalThis.fetch;
  const clientId = await (options.getClientId ?? getSoundCloudClientId)();
  const resolveUrl = new URL("https://api-v2.soundcloud.com/resolve");
  resolveUrl.searchParams.set("url", sourceUrl);
  resolveUrl.searchParams.set("client_id", clientId);
  const response = await fetch(resolveUrl, { signal: options.signal });
  if (!response.ok) throw new Error(`track_metadata.fetch_failed (${response.status})`);
  const metadata = await Effect.runPromise(
    Schema.decodeUnknownEffect(soundCloudTrackSchema)(await response.json()),
  );
  return {
    title: metadata.title.trim(),
    artist: metadata.user?.username?.trim() ?? "",
    coverUrl: metadata.artwork_url?.replace(/-large/, "-t1080x1080") ?? undefined,
  };
};

export const getTrackMetadataEndpoint = (sourceUrl: string) => {
  const url = new URL(sourceUrl);
  const isYouTube =
    url.hostname === "youtu.be" ||
    url.hostname === "youtube.com" ||
    url.hostname.endsWith(".youtube.com");
  if (isYouTube) {
    const endpoint = new URL("https://www.youtube.com/oembed");
    endpoint.searchParams.set("url", sourceUrl);
    endpoint.searchParams.set("format", "json");
    return endpoint;
  }

  return undefined;
};

export const normalizeTrackMetadataArtist = (artist: string, endpoint: URL) =>
  endpoint.hostname.endsWith("youtube.com") ? artist.replace(/\s*-\s*Topic$/i, "").trim() : artist;

export default defineHandler(async (event) => {
  const requestUrl = new URL(event.req.url, "http://tagium.local");
  const sourceUrl = requestUrl.searchParams.get("url");
  if (!sourceUrl) throw new Error("track_metadata.url_required");

  if (isSoundCloudUrl(new URL(sourceUrl))) {
    return resolveSoundCloudTrackMetadata(sourceUrl, { signal: event.req.signal });
  }

  const endpoint = getTrackMetadataEndpoint(sourceUrl);
  if (!endpoint) return new Response(null, { status: 204 });

  const response = await fetch(endpoint, { signal: event.req.signal });
  if (!response.ok) throw new Error(`track_metadata.fetch_failed (${response.status})`);
  const metadata = await Effect.runPromise(
    Schema.decodeUnknownEffect(oEmbedSchema)(await response.json()),
  );

  return {
    title: metadata.title.trim(),
    artist: normalizeTrackMetadataArtist(metadata.author_name?.trim() ?? "", endpoint),
    coverUrl: metadata.thumbnail_url,
  };
});
