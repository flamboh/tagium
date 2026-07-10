/*
 * SoundCloud client id discovery adapted from imputnet/cobalt:
 * api/src/processing/services/soundcloud.js
 */
import { defineHandler } from "nitro";
import { z } from "zod";
import { getSoundCloudClientId } from "../utils/soundcloud";

const TRACK_RESOLVE_CONCURRENCY = 4;

const soundCloudTrackSchema = z.object({
  id: z.number(),
  kind: z.literal("track"),
  title: z.string().optional(),
  permalink_url: z.string().url().optional(),
  duration: z.number().optional(),
});
const soundCloudTrackListEntrySchema = z.unknown().transform((entry) => {
  const parsedEntry = soundCloudTrackSchema.safeParse(entry);
  return parsedEntry.success ? parsedEntry.data : undefined;
});

const soundCloudPlaylistSchema = z.object({
  kind: z.literal("playlist"),
  title: z.string(),
  genre: z.string().optional(),
  display_date: z.string().optional(),
  release_date: z.string().nullable().optional(),
  is_album: z.boolean().optional(),
  set_type: z.string().optional(),
  artwork_url: z.string().nullable().optional(),
  user: z
    .object({
      username: z.string().optional(),
    })
    .optional(),
  tracks: z.array(soundCloudTrackListEntrySchema),
});
const soundCloudResolvedTrackSchema = soundCloudTrackSchema.extend({
  title: z.string(),
  permalink_url: z.string().url(),
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

const resolveTrack = async (clientId: string, track: z.infer<typeof soundCloudTrackSchema>) => {
  if (track.title && track.permalink_url) {
    return soundCloudResolvedTrackSchema.parse(track);
  }

  const trackUrl = new URL(`https://api-v2.soundcloud.com/tracks/${track.id}`);
  trackUrl.searchParams.set("client_id", clientId);
  return soundCloudResolvedTrackSchema.parse(
    await fetch(trackUrl).then((response) => response.json()),
  );
};

const resolveTracks = async (clientId: string, tracks: z.infer<typeof soundCloudTrackSchema>[]) => {
  const resolvedTracks: z.infer<typeof soundCloudResolvedTrackSchema>[] = [];

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

  const playlist = soundCloudPlaylistSchema.parse(
    await fetch(resolveUrl).then((response) => response.json()),
  );
  const trackEntries = playlist.tracks.filter((track) => track !== undefined);
  const tracks = await resolveTracks(clientId, trackEntries);
  const isAlbum = [playlist.is_album, playlist.set_type === "album"].includes(true);
  let yearDate = playlist.display_date;
  if (isAlbum && playlist.release_date) {
    yearDate = playlist.release_date;
  }

  return {
    title: playlist.title.trim(),
    artist: playlist.user?.username?.trim() ?? "",
    genre: playlist.genre?.trim() ?? "",
    year: getYear(yearDate),
    isAlbum,
    coverUrl: getCoverUrl(playlist.artwork_url),
    tracks: tracks.map((track, index) => ({
      title: track.title.trim(),
      url: track.permalink_url,
      duration: track.duration,
      trackNumber: index + 1,
    })),
  };
});
