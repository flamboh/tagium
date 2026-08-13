import { Option, Schema } from "effect";
import { defineHandler } from "nitro";
import {
  extractYouTubeJsonObject,
  fetchYouTubeWithRetry,
  getYouTubeConfig,
  resolveYouTubeUploadYear,
  YOUTUBE_ORIGIN,
  YOUTUBE_USER_AGENT,
} from "../utils/youtube";
import { urlStringSchema } from "../utils/schema";
import { parseMediaLink } from "../../src/lib/media-link";

const MAX_CONTINUATION_REQUESTS = 100;

const textSchema = Schema.Struct({
  simpleText: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(Schema.String),
  runs: Schema.optionalKey(Schema.Array(Schema.Struct({ text: Schema.String }))),
});

const nonEmptyStringSchema = Schema.String.check(Schema.isNonEmpty());

const legacyVideoSchema = Schema.Struct({
  videoId: nonEmptyStringSchema,
  title: textSchema,
  lengthSeconds: Schema.optionalKey(Schema.String),
  lengthText: Schema.optionalKey(textSchema),
});

const lockupVideoSchema = Schema.Struct({
  contentId: nonEmptyStringSchema,
  contentType: Schema.optionalKey(Schema.String),
  metadata: Schema.Struct({
    lockupMetadataViewModel: Schema.Struct({
      title: textSchema,
    }),
  }),
});

const thumbnailSchema = Schema.Struct({
  thumbnail: Schema.Struct({
    thumbnails: Schema.Array(
      Schema.Struct({
        url: urlStringSchema,
        width: Schema.optionalKey(Schema.Finite),
        height: Schema.optionalKey(Schema.Finite),
      }),
    ),
  }),
});

const decodeTextOption = Schema.decodeUnknownOption(textSchema);
const decodeLegacyVideoOption = Schema.decodeUnknownOption(legacyVideoSchema);
const decodeLockupVideoOption = Schema.decodeUnknownOption(lockupVideoSchema);
const decodeThumbnailOption = Schema.decodeUnknownOption(thumbnailSchema);

interface JsonRecord {
  [key: string]: JsonValue;
}
type JsonValue = string | number | boolean | null | JsonRecord | readonly JsonValue[];
const jsonValueSchema: Schema.Codec<JsonValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.String,
    Schema.Finite,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(jsonValueSchema),
    Schema.Record(Schema.String, jsonValueSchema),
  ]),
);
const jsonRecordSchema = Schema.Record(Schema.String, jsonValueSchema);

interface YouTubeTrack {
  title: string;
  url: string;
  duration?: number;
  trackNumber: number;
}
interface YouTubePlaylist {
  title: string;
  artist: string;
  genre: string;
  isAlbum: false;
  year?: number;
  coverUrl?: string;
  tracks: YouTubeTrack[];
}

const isRecord = Schema.is(jsonRecordSchema);
const isString = Schema.is(Schema.String);

const getText = (value: JsonValue | undefined) => {
  const parsed = decodeTextOption(value);
  if (Option.isNone(parsed)) return undefined;
  if (parsed.value.simpleText) return parsed.value.simpleText;
  if (parsed.value.content) return parsed.value.content;
  const runs = parsed.value.runs?.map((run) => run.text).join("");
  return runs || undefined;
};

const findFirstValue = (value: JsonValue, key: string): JsonValue | undefined => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findFirstValue(entry, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (value[key] !== undefined) return value[key];

  for (const entry of Object.values(value)) {
    const found = findFirstValue(entry, key);
    if (found !== undefined) return found;
  }
  return undefined;
};

const parseDuration = (value: string | undefined) => {
  if (!value) return undefined;
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.some((part) => !/^\d+$/.test(part))) return undefined;
  return parts.reduce((seconds, part) => seconds * 60 + Number(part), 0);
};

const findDuration = (value: JsonValue): number | undefined => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const duration = findDuration(entry);
      if (duration !== undefined) return duration;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  const directText = isString(value.text) ? value.text : undefined;
  const parsedDuration = parseDuration(directText);
  if (parsedDuration !== undefined) return parsedDuration;

  for (const entry of Object.values(value)) {
    const duration = findDuration(entry);
    if (duration !== undefined) return duration;
  }
  return undefined;
};

const collectTracks = (value: JsonValue, seenVideoIds: Set<string>, tracks: YouTubeTrack[]) => {
  if (Array.isArray(value)) {
    for (const entry of value) collectTracks(entry, seenVideoIds, tracks);
    return;
  }
  if (!isRecord(value)) return;

  const legacyVideo = decodeLegacyVideoOption(value.playlistVideoRenderer);
  if (Option.isSome(legacyVideo) && !seenVideoIds.has(legacyVideo.value.videoId)) {
    const title = getText(legacyVideo.value.title)?.trim();
    if (title) {
      const durationFromSeconds = Number(legacyVideo.value.lengthSeconds);
      seenVideoIds.add(legacyVideo.value.videoId);
      tracks.push({
        title,
        url: `${YOUTUBE_ORIGIN}/watch?v=${encodeURIComponent(legacyVideo.value.videoId)}`,
        duration: Number.isFinite(durationFromSeconds)
          ? durationFromSeconds
          : parseDuration(getText(legacyVideo.value.lengthText)),
        trackNumber: tracks.length + 1,
      });
    }
  }

  const lockupVideo = decodeLockupVideoOption(value.lockupViewModel);
  if (
    Option.isSome(lockupVideo) &&
    (!lockupVideo.value.contentType ||
      lockupVideo.value.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") &&
    !seenVideoIds.has(lockupVideo.value.contentId)
  ) {
    const title = getText(lockupVideo.value.metadata.lockupMetadataViewModel.title)?.trim();
    if (title) {
      seenVideoIds.add(lockupVideo.value.contentId);
      tracks.push({
        title,
        url: `${YOUTUBE_ORIGIN}/watch?v=${encodeURIComponent(lockupVideo.value.contentId)}`,
        duration: findDuration(value.lockupViewModel),
        trackNumber: tracks.length + 1,
      });
    }
  }

  for (const entry of Object.values(value)) collectTracks(entry, seenVideoIds, tracks);
};

const collectContinuationTokens = (value: JsonValue, tokens: string[]) => {
  if (Array.isArray(value)) {
    for (const entry of value) collectContinuationTokens(entry, tokens);
    return;
  }
  if (!isRecord(value)) return;

  const continuationCommand = value.continuationCommand;
  if (isRecord(continuationCommand) && isString(continuationCommand.token)) {
    tokens.push(continuationCommand.token);
  }

  for (const entry of Object.values(value)) collectContinuationTokens(entry, tokens);
};

const getPlaylistTitle = (initialData: JsonValue) => {
  const metadata = findFirstValue(initialData, "playlistMetadataRenderer");
  return metadata !== undefined && isRecord(metadata) && isString(metadata.title)
    ? metadata.title.trim()
    : "";
};

const getPlaylistArtist = (initialData: JsonValue) => {
  const owner = findFirstValue(initialData, "videoOwnerRenderer");
  return owner !== undefined && isRecord(owner) ? (getText(owner.title)?.trim() ?? "") : "";
};

const getPlaylistCover = (initialData: JsonValue) => {
  const parsed = decodeThumbnailOption(
    findFirstValue(initialData, "playlistVideoThumbnailRenderer"),
  );
  if (Option.isNone(parsed) || parsed.value.thumbnail.thumbnails.length === 0) return undefined;
  const coverUrl = parsed.value.thumbnail.thumbnails.reduce((largest, thumbnail) => {
    const largestArea = (largest.width ?? 0) * (largest.height ?? 0);
    const thumbnailArea = (thumbnail.width ?? 0) * (thumbnail.height ?? 0);
    return thumbnailArea >= largestArea ? thumbnail : largest;
  }).url;
  const proxyUrl = new URL("/api/youtube-cover", "http://tagium.local");
  proxyUrl.searchParams.set("url", coverUrl);
  return `${proxyUrl.pathname}${proxyUrl.search}`;
};

const getDeclaredTrackCount = (initialData: JsonValue) => {
  const primaryInfo = findFirstValue(initialData, "playlistSidebarPrimaryInfoRenderer");
  if (primaryInfo === undefined || !isRecord(primaryInfo) || !Array.isArray(primaryInfo.stats)) {
    return undefined;
  }
  for (const stat of primaryInfo.stats) {
    const match = getText(stat)?.match(/([\d,]+)\s+videos?/i);
    if (!match) continue;
    const count = Number(match[1]?.replaceAll(",", ""));
    if (Number.isFinite(count)) return count;
  }
  return undefined;
};

const fetchContinuation = async (token: string, config: JsonRecord, signal: AbortSignal) => {
  const apiKey = config.INNERTUBE_API_KEY;
  const context = config.INNERTUBE_CONTEXT;
  const clientVersion = config.INNERTUBE_CLIENT_VERSION;
  if (!isString(apiKey) || !isRecord(context) || !isString(clientVersion)) {
    return undefined;
  }

  const endpoint = new URL("/youtubei/v1/browse", YOUTUBE_ORIGIN);
  endpoint.searchParams.set("key", apiKey);
  const response = await fetchYouTubeWithRetry(
    endpoint,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": YOUTUBE_USER_AGENT,
        "x-youtube-client-name": "1",
        "x-youtube-client-version": clientVersion,
      },
      body: JSON.stringify({ context, continuation: token }),
      signal,
    },
    { stage: "continuation" },
  );
  if (!response.ok) throw new Error(`youtube.continuation_failed (${response.status})`);
  return Schema.decodeUnknownSync(jsonValueSchema)(await response.json());
};

const parseSourceUrl = (sourceUrl: string) => {
  const parsed = parseMediaLink(sourceUrl);
  if (parsed.provider !== "youtube" || parsed.kind !== "playlist") {
    throw new Error("youtube.playlist_url_required");
  }
  return parsed.playlistId;
};

export default defineHandler(async (event) => {
  const requestUrl = new URL(event.req.url, "http://tagium.local");
  const sourceUrl = requestUrl.searchParams.get("url");
  if (!sourceUrl) throw new Error("youtube.url_required");

  const playlistId = parseSourceUrl(sourceUrl);
  const playlistUrl = new URL("/playlist", YOUTUBE_ORIGIN);
  playlistUrl.searchParams.set("list", playlistId);
  playlistUrl.searchParams.set("hl", "en");

  const response = await fetchYouTubeWithRetry(
    playlistUrl,
    {
      headers: {
        "accept-language": "en-US,en;q=0.9",
        "user-agent": YOUTUBE_USER_AGENT,
      },
      signal: event.req.signal,
    },
    { stage: "playlist" },
  );
  if (!response.ok) throw new Error(`youtube.playlist_failed (${response.status})`);
  const html = await response.text();
  const initialData = extractYouTubeJsonObject(html, "var ytInitialData =")?.value;
  if (!initialData) throw new Error("youtube.initial_data");
  const config = getYouTubeConfig(html);

  const title = getPlaylistTitle(initialData);
  if (!title) throw new Error("youtube.playlist_title");

  const tracks: YouTubeTrack[] = [];
  const seenVideoIds = new Set<string>();
  collectTracks(initialData, seenVideoIds, tracks);

  const declaredTrackCount = getDeclaredTrackCount(initialData);
  if (declaredTrackCount === undefined || tracks.length < declaredTrackCount) {
    const pendingTokens: string[] = [];
    const visitedTokens = new Set<string>();
    collectContinuationTokens(initialData, pendingTokens);
    while (pendingTokens.length > 0 && visitedTokens.size < MAX_CONTINUATION_REQUESTS) {
      const token = pendingTokens.shift();
      if (!token || visitedTokens.has(token)) continue;
      visitedTokens.add(token);

      const continuation = await fetchContinuation(token, config, event.req.signal);
      if (!continuation) break;
      collectTracks(continuation, seenVideoIds, tracks);
      if (declaredTrackCount !== undefined && tracks.length >= declaredTrackCount) break;
      collectContinuationTokens(continuation, pendingTokens);
    }
  }

  if (tracks.length === 0) throw new Error("youtube.no_resolvable_tracks");
  let year: number | undefined;
  try {
    year = await resolveYouTubeUploadYear(tracks[0]!.url, {
      config,
      signal: event.req.signal,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "youtube_playlist_enrichment_skipped",
        stage: "upload_year",
        errorType: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }

  const playlist: YouTubePlaylist = {
    title,
    artist: getPlaylistArtist(initialData),
    genre: "",
    isAlbum: false,
    coverUrl: getPlaylistCover(initialData),
    tracks,
  };
  if (year !== undefined) playlist.year = year;
  return playlist;
});
