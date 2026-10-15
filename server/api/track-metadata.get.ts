import { Effect, Schema } from "effect";
import { defineHandler } from "nitro";
import { getSoundCloudLogContext } from "../utils/soundcloud-observability";
import {
  isSoundCloudTrackUrl,
  normalizeTrackSourceUrl,
  resolveSoundCloudTrack,
  soundCloudCoverUrl,
} from "../utils/soundcloud-track";
import { urlStringSchema } from "../utils/schema";
import { parseMediaLink } from "../../src/lib/media-link";

const nonEmptyStringSchema = Schema.String.check(Schema.isNonEmpty());

const oEmbedSchema = Schema.Struct({
  title: nonEmptyStringSchema,
  author_name: Schema.optionalKey(Schema.String),
  thumbnail_url: Schema.optionalKey(urlStringSchema),
});

export const getTrackMetadataEndpoint = (sourceUrl: string) => {
  const parsed = parseMediaLink(sourceUrl);

  if (parsed.provider !== "youtube" || parsed.kind !== "track") return undefined;

  if (parsed.provider === "youtube") {
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
  const requestedSourceUrl = requestUrl.searchParams.get("url");

  if (!requestedSourceUrl) throw new Error("track_metadata.url_required");
  const sourceUrl = await normalizeTrackSourceUrl(requestedSourceUrl, event.req.signal);

  if (isSoundCloudTrackUrl(sourceUrl)) {
    const { track } = await Effect.runPromise(
      resolveSoundCloudTrack(sourceUrl, getSoundCloudLogContext(event.req, sourceUrl)),
      { signal: event.req.signal },
    );

    return {
      title: track.title.trim(),
      artist: track.user?.username?.trim() ?? "",
      coverUrl: soundCloudCoverUrl(track.artwork_url) ?? undefined,
    };
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
