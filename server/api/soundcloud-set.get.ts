/*
 * SoundCloud client id discovery adapted from imputnet/cobalt:
 * api/src/processing/services/soundcloud.js
 */
import { Effect, Option, Schema } from "effect";
import { defineHandler } from "nitro";
import { getSoundCloudClientId } from "../utils/soundcloud";
import { urlStringSchema } from "../utils/schema";

const TRACK_RESOLVE_CONCURRENCY = 4;

const soundCloudTrackSchema = Schema.Struct({
  id: Schema.Finite,
  kind: Schema.Literal("track"),
  title: Schema.optionalKey(Schema.String),
  permalink_url: Schema.optionalKey(urlStringSchema),
  duration: Schema.optionalKey(Schema.Finite),
  artwork_url: Schema.optionalKey(Schema.NullOr(urlStringSchema)),
});
const decodeSoundCloudTrackOption = Schema.decodeUnknownOption(soundCloudTrackSchema);

const soundCloudPlaylistSchema = Schema.Struct({
  kind: Schema.Literal("playlist"),
  title: Schema.String,
  genre: Schema.optionalKey(Schema.String),
  display_date: Schema.optionalKey(Schema.String),
  release_date: Schema.optionalKey(Schema.NullOr(Schema.String)),
  is_album: Schema.optionalKey(Schema.Boolean),
  set_type: Schema.optionalKey(Schema.String),
  artwork_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  user: Schema.optionalKey(
    Schema.Struct({
      username: Schema.optionalKey(Schema.String),
    }),
  ),
  tracks: Schema.Array(Schema.Unknown),
});
const soundCloudResolvedTrackSchema = Schema.Struct({
  id: Schema.Finite,
  kind: Schema.Literal("track"),
  title: Schema.String,
  permalink_url: urlStringSchema,
  duration: Schema.optionalKey(Schema.Finite),
  artwork_url: Schema.optionalKey(Schema.NullOr(urlStringSchema)),
});

const getCoverUrl = (artworkUrl: string | null | undefined) => {
  if (!artworkUrl) {
    return undefined;
  }

  return artworkUrl.replace(/-large/, "-t1080x1080");
};

const getYear = (displayDate: string | undefined) => {
  const year = Number.parseInt(displayDate?.slice(0, 4) ?? "", 10);
  return Number.isNaN(year) ? undefined : year;
};

const resolveTrack = async (
  clientId: string,
  track: Schema.Schema.Type<typeof soundCloudTrackSchema>,
) => {
  if (track.title && track.permalink_url) {
    return Effect.runPromise(Schema.decodeUnknownEffect(soundCloudResolvedTrackSchema)(track));
  }

  const trackUrl = new URL(`https://api-v2.soundcloud.com/tracks/${track.id}`);
  trackUrl.searchParams.set("client_id", clientId);
  return Effect.runPromise(
    Schema.decodeUnknownEffect(soundCloudResolvedTrackSchema)(
      await fetch(trackUrl).then((response) => response.json()),
    ),
  );
};

const resolveTracks = async (
  clientId: string,
  tracks: ReadonlyArray<Schema.Schema.Type<typeof soundCloudTrackSchema>>,
) => {
  const resolvedTracks: Array<Schema.Schema.Type<typeof soundCloudResolvedTrackSchema>> = [];

  for (let index = 0; index < tracks.length; index += TRACK_RESOLVE_CONCURRENCY) {
    const chunk = tracks.slice(index, index + TRACK_RESOLVE_CONCURRENCY);
    const settledTracks = await Promise.allSettled(
      chunk.map((track) => resolveTrack(clientId, track)),
    );

    for (const settledTrack of settledTracks) {
      if (settledTrack.status === "fulfilled") {
        resolvedTracks.push(settledTrack.value);
      }
    }
  }

  if (resolvedTracks.length === 0) {
    throw new Error("soundcloud.no_resolvable_tracks");
  }

  return resolvedTracks;
};

export default defineHandler(async (event) => {
  const requestUrl = new URL(event.req.url, "http://tagium.local");
  const sourceUrl = requestUrl.searchParams.get("url");

  if (!sourceUrl) {
    throw new Error("soundcloud.url_required");
  }

  const clientId = await getSoundCloudClientId();
  const resolveUrl = new URL("https://api-v2.soundcloud.com/resolve");
  resolveUrl.searchParams.set("url", sourceUrl);
  resolveUrl.searchParams.set("client_id", clientId);

  const playlist = await Effect.runPromise(
    Schema.decodeUnknownEffect(soundCloudPlaylistSchema)(
      await fetch(resolveUrl).then((response) => response.json()),
    ),
  );
  const trackEntries = playlist.tracks.flatMap((entry) => {
    const track = decodeSoundCloudTrackOption(entry);
    return Option.isSome(track) ? [track.value] : [];
  });
  const tracks = await resolveTracks(clientId, trackEntries);
  const isAlbum = [playlist.is_album, playlist.set_type === "album"].includes(true);
  let yearDate = playlist.display_date;
  if (isAlbum && playlist.release_date) {
    yearDate = playlist.release_date;
  }
  const artworkUrl = playlist.artwork_url ?? tracks.find((track) => track.artwork_url)?.artwork_url;

  return {
    title: playlist.title.trim(),
    artist: playlist.user?.username?.trim() ?? "",
    genre: playlist.genre?.trim() ?? "",
    year: getYear(yearDate),
    isAlbum,
    coverUrl: getCoverUrl(artworkUrl),
    tracks: tracks.map((track, index) => ({
      title: track.title.trim(),
      url: track.permalink_url,
      duration: track.duration,
      trackNumber: index + 1,
    })),
  };
});
