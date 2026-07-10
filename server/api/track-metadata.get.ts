import { defineHandler } from "nitro";
import { z } from "zod";
import { getSoundCloudClientId } from "../utils/soundcloud";

const oEmbedSchema = z.object({
  title: z.string().min(1),
  author_name: z.string().optional(),
  thumbnail_url: z.string().url().optional(),
});
const soundCloudTrackSchema = z.object({
  title: z.string().min(1),
  artwork_url: z.string().url().nullable().optional(),
  user: z.object({ username: z.string().optional() }).optional(),
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
  const metadata = soundCloudTrackSchema.parse(await response.json());
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
  const metadata = oEmbedSchema.parse(await response.json());

  return {
    title: metadata.title.trim(),
    artist: normalizeTrackMetadataArtist(metadata.author_name?.trim() ?? "", endpoint),
    coverUrl: metadata.thumbnail_url,
  };
});
