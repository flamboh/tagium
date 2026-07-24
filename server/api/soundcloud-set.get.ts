/*
 * SoundCloud client id discovery adapted from imputnet/cobalt:
 * api/src/processing/services/soundcloud.js
 */
import { Effect, Option, Schema } from "effect";
import { defineHandler } from "nitro";
import { getSoundCloudClientId } from "../utils/soundcloud";
import {
  getSoundCloudLogContext,
  logSoundCloudCompletion,
  logSoundCloudFailure,
  type SoundCloudLogContext,
} from "../utils/soundcloud-observability";
import { urlStringSchema } from "../utils/schema";

const TRACK_RESOLVE_CONCURRENCY = 4;

class SoundCloudTrackResolveError extends Error {
  constructor(
    readonly stage: "track.resolve_fetch" | "track.resolve_parse",
    options?: ErrorOptions,
  ) {
    super(stage, options);
    this.name = "SoundCloudTrackResolveError";
  }
}

const soundCloudTrackSchema = Schema.Struct({
  id: Schema.Finite,
  kind: Schema.Literal("track"),
  title: Schema.optionalKey(Schema.String),
  permalink_url: Schema.optionalKey(urlStringSchema),
  duration: Schema.optionalKey(Schema.Finite),
  artwork_url: Schema.optionalKey(Schema.NullOr(urlStringSchema)),
});
const decodeSoundCloudTrackOption = Schema.decodeUnknownOption(soundCloudTrackSchema);
type IndexedSoundCloudTrack = {
  track: Schema.Schema.Type<typeof soundCloudTrackSchema>;
  trackIndex: number;
};

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
  context: SoundCloudLogContext,
) => {
  if (track.title && track.permalink_url) {
    return Effect.runPromise(Schema.decodeUnknownEffect(soundCloudResolvedTrackSchema)(track));
  }

  const trackUrl = new URL(`https://api-v2.soundcloud.com/tracks/${track.id}`);
  trackUrl.searchParams.set("client_id", clientId);
  const startedAt = Date.now();
  let parseFailure = false;
  try {
    const response = await fetch(trackUrl);
    const contentType = response.headers.get("content-type") ?? undefined;
    if (!response.ok) {
      await logSoundCloudFailure(
        "track.resolve_fetch",
        context,
        {
          upstreamStatus: response.status,
          ...(contentType ? { contentType } : {}),
          ...(response.headers.get("retry-after")
            ? { retryAfter: response.headers.get("retry-after") }
            : {}),
        },
        startedAt,
      );
      throw new SoundCloudTrackResolveError("track.resolve_fetch");
    }
    try {
      return Effect.runPromise(
        Schema.decodeUnknownEffect(soundCloudResolvedTrackSchema)(await response.json()),
      );
    } catch (error) {
      parseFailure = true;
      await logSoundCloudFailure(
        "track.resolve_parse",
        context,
        {
          ...(contentType ? { contentType } : {}),
          errorType: error instanceof Error ? error.name : "UnknownError",
        },
        startedAt,
      );
      throw new SoundCloudTrackResolveError("track.resolve_parse", { cause: error });
    }
  } catch (error) {
    if (!parseFailure && !(error instanceof SoundCloudTrackResolveError)) {
      await logSoundCloudFailure(
        "track.resolve_fetch",
        context,
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        startedAt,
      );
      throw new SoundCloudTrackResolveError("track.resolve_fetch", { cause: error });
    }
    throw error;
  }
};

const resolveTracks = async (
  clientId: string,
  tracks: ReadonlyArray<IndexedSoundCloudTrack>,
  context: SoundCloudLogContext,
  trackCount: number,
  decodeFailures: number,
) => {
  const resolvedTracks: Array<{
    track: Schema.Schema.Type<typeof soundCloudResolvedTrackSchema>;
    trackIndex: number;
  }> = [];
  let failedTracks = decodeFailures;
  const failuresByStage: Record<string, number> = decodeFailures
    ? { "track.entry_parse": decodeFailures }
    : {};

  for (let index = 0; index < tracks.length; index += TRACK_RESOLVE_CONCURRENCY) {
    const chunk = tracks.slice(index, index + TRACK_RESOLVE_CONCURRENCY);
    const settledTracks = await Promise.allSettled(
      chunk.map(({ track, trackIndex }) =>
        resolveTrack(clientId, track, {
          ...context,
          trackIndex,
        }),
      ),
    );

    for (const [chunkIndex, settledTrack] of settledTracks.entries()) {
      const trackIndex = chunk[chunkIndex].trackIndex;
      if (settledTrack.status === "fulfilled") {
        resolvedTracks.push({ track: settledTrack.value, trackIndex });
      } else {
        failedTracks++;
        const stage =
          settledTrack.reason instanceof SoundCloudTrackResolveError
            ? settledTrack.reason.stage
            : "track.resolve_unknown";
        failuresByStage[stage] = (failuresByStage[stage] ?? 0) + 1;
      }
    }
  }

  if (resolvedTracks.length === 0) {
    await logSoundCloudCompletion(context, {
      trackCount,
      succeeded: 0,
      failed: failedTracks,
      failuresByStage,
    });
    throw new Error("soundcloud.no_resolvable_tracks");
  }

  await logSoundCloudCompletion(context, {
    trackCount,
    succeeded: resolvedTracks.length,
    failed: failedTracks,
    failuresByStage,
  });

  return resolvedTracks;
};

export default defineHandler(async (event) => {
  const requestUrl = new URL(event.req.url, "http://tagium.local");
  const sourceUrl = requestUrl.searchParams.get("url");

  if (!sourceUrl) {
    throw new Error("soundcloud.url_required");
  }

  const context = getSoundCloudLogContext(event.req, sourceUrl ?? undefined);
  const clientId = await getSoundCloudClientId(globalThis.fetch, context);
  const resolveUrl = new URL("https://api-v2.soundcloud.com/resolve");
  resolveUrl.searchParams.set("url", sourceUrl);
  resolveUrl.searchParams.set("client_id", clientId);

  const playlistStartedAt = Date.now();
  let playlistResponse: Response;
  try {
    playlistResponse = await fetch(resolveUrl);
  } catch (error) {
    await logSoundCloudFailure(
      "playlist.resolve_fetch",
      context,
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      playlistStartedAt,
    );
    throw error;
  }
  const contentType = playlistResponse.headers.get("content-type") ?? undefined;
  if (!playlistResponse.ok) {
    await logSoundCloudFailure(
      "playlist.resolve_fetch",
      context,
      {
        upstreamStatus: playlistResponse.status,
        ...(contentType ? { contentType } : {}),
        ...(playlistResponse.headers.get("retry-after")
          ? { retryAfter: playlistResponse.headers.get("retry-after") }
          : {}),
      },
      playlistStartedAt,
    );
    throw new Error(`soundcloud.playlist.resolve_http_${playlistResponse.status}`);
  }
  let playlistBody: unknown;
  try {
    playlistBody = await playlistResponse.json();
  } catch (error) {
    await logSoundCloudFailure(
      "playlist.resolve_parse",
      context,
      { contentType, errorType: error instanceof Error ? error.name : "UnknownError" },
      playlistStartedAt,
    );
    throw error;
  }
  let playlist: Schema.Schema.Type<typeof soundCloudPlaylistSchema>;
  try {
    playlist = await Effect.runPromise(
      Schema.decodeUnknownEffect(soundCloudPlaylistSchema)(playlistBody),
    );
  } catch (error) {
    await logSoundCloudFailure(
      "playlist.resolve_parse",
      context,
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      playlistStartedAt,
    );
    throw error;
  }
  const trackEntries: IndexedSoundCloudTrack[] = [];
  const decodeFailureLogs: Promise<void>[] = [];
  let decodeFailures = 0;
  for (const [index, entry] of playlist.tracks.entries()) {
    const track = decodeSoundCloudTrackOption(entry);
    if (Option.isSome(track)) {
      trackEntries.push({ track: track.value, trackIndex: index + 1 });
      continue;
    }

    decodeFailures++;
    decodeFailureLogs.push(
      logSoundCloudFailure("track.entry_parse", {
        ...context,
        trackIndex: index + 1,
      }),
    );
  }
  await Promise.all(decodeFailureLogs);
  const tracks = await resolveTracks(
    clientId,
    trackEntries,
    context,
    playlist.tracks.length,
    decodeFailures,
  );
  const isAlbum = [playlist.is_album, playlist.set_type === "album"].includes(true);
  let yearDate = playlist.display_date;
  if (isAlbum && playlist.release_date) {
    yearDate = playlist.release_date;
  }
  const artworkUrl =
    playlist.artwork_url ?? tracks.find(({ track }) => track.artwork_url)?.track.artwork_url;

  return {
    title: playlist.title.trim(),
    artist: playlist.user?.username?.trim() ?? "",
    genre: playlist.genre?.trim() ?? "",
    year: getYear(yearDate),
    isAlbum,
    coverUrl: getCoverUrl(artworkUrl),
    tracks: tracks.map(({ track, trackIndex }) => ({
      title: track.title.trim(),
      url: track.permalink_url,
      duration: track.duration,
      trackNumber: trackIndex,
    })),
  };
});
