import { defineHandler } from "nitro";
import { z } from "zod";
import {
  extractYouTubeJsonObject,
  getYouTubeConfig,
  resolveYouTubeUploadYear,
  YOUTUBE_ORIGIN,
  YOUTUBE_USER_AGENT,
} from "../utils/youtube";

const MAX_CONTINUATION_REQUESTS = 100;

const textSchema = z
  .object({
    simpleText: z.string().optional(),
    content: z.string().optional(),
    runs: z.array(z.object({ text: z.string() }).passthrough()).optional(),
  })
  .passthrough();

const legacyVideoSchema = z
  .object({
    videoId: z.string().min(1),
    title: textSchema,
    lengthSeconds: z.string().optional(),
    lengthText: textSchema.optional(),
  })
  .passthrough();

const lockupVideoSchema = z
  .object({
    contentId: z.string().min(1),
    contentType: z.string().optional(),
    metadata: z
      .object({
        lockupMetadataViewModel: z
          .object({
            title: textSchema,
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const thumbnailSchema = z
  .object({
    thumbnail: z
      .object({
        thumbnails: z.array(
          z
            .object({
              url: z.string().url(),
              width: z.number().optional(),
              height: z.number().optional(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
  })
  .passthrough();

type JsonRecord = Record<string, unknown>;

interface YouTubeTrack {
  title: string;
  url: string;
  duration?: number;
  trackNumber: number;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getText = (value: unknown) => {
  const parsed = textSchema.safeParse(value);
  if (!parsed.success) return undefined;
  if (parsed.data.simpleText) return parsed.data.simpleText;
  if (parsed.data.content) return parsed.data.content;
  const runs = parsed.data.runs?.map((run) => run.text).join("");
  return runs || undefined;
};

const findFirstValue = (value: unknown, key: string): unknown => {
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

const findDuration = (value: unknown): number | undefined => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const duration = findDuration(entry);
      if (duration !== undefined) return duration;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  const directText = typeof value.text === "string" ? value.text : undefined;
  const parsedDuration = parseDuration(directText);
  if (parsedDuration !== undefined) return parsedDuration;

  for (const entry of Object.values(value)) {
    const duration = findDuration(entry);
    if (duration !== undefined) return duration;
  }
  return undefined;
};

const collectTracks = (value: unknown, seenVideoIds: Set<string>, tracks: YouTubeTrack[]) => {
  if (Array.isArray(value)) {
    for (const entry of value) collectTracks(entry, seenVideoIds, tracks);
    return;
  }
  if (!isRecord(value)) return;

  const legacyVideo = legacyVideoSchema.safeParse(value.playlistVideoRenderer);
  if (legacyVideo.success && !seenVideoIds.has(legacyVideo.data.videoId)) {
    const title = getText(legacyVideo.data.title)?.trim();
    if (title) {
      const durationFromSeconds = Number(legacyVideo.data.lengthSeconds);
      seenVideoIds.add(legacyVideo.data.videoId);
      tracks.push({
        title,
        url: `${YOUTUBE_ORIGIN}/watch?v=${encodeURIComponent(legacyVideo.data.videoId)}`,
        duration: Number.isFinite(durationFromSeconds)
          ? durationFromSeconds
          : parseDuration(getText(legacyVideo.data.lengthText)),
        trackNumber: tracks.length + 1,
      });
    }
  }

  const lockupVideo = lockupVideoSchema.safeParse(value.lockupViewModel);
  if (
    lockupVideo.success &&
    (!lockupVideo.data.contentType ||
      lockupVideo.data.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") &&
    !seenVideoIds.has(lockupVideo.data.contentId)
  ) {
    const title = getText(lockupVideo.data.metadata.lockupMetadataViewModel.title)?.trim();
    if (title) {
      seenVideoIds.add(lockupVideo.data.contentId);
      tracks.push({
        title,
        url: `${YOUTUBE_ORIGIN}/watch?v=${encodeURIComponent(lockupVideo.data.contentId)}`,
        duration: findDuration(lockupVideo.data),
        trackNumber: tracks.length + 1,
      });
    }
  }

  for (const entry of Object.values(value)) collectTracks(entry, seenVideoIds, tracks);
};

const collectContinuationTokens = (value: unknown, tokens: string[]) => {
  if (Array.isArray(value)) {
    for (const entry of value) collectContinuationTokens(entry, tokens);
    return;
  }
  if (!isRecord(value)) return;

  const continuationCommand = value.continuationCommand;
  if (isRecord(continuationCommand) && typeof continuationCommand.token === "string") {
    tokens.push(continuationCommand.token);
  }

  for (const entry of Object.values(value)) collectContinuationTokens(entry, tokens);
};

const getPlaylistTitle = (initialData: unknown) => {
  const metadata = findFirstValue(initialData, "playlistMetadataRenderer");
  return isRecord(metadata) && typeof metadata.title === "string" ? metadata.title.trim() : "";
};

const getPlaylistArtist = (initialData: unknown) => {
  const owner = findFirstValue(initialData, "videoOwnerRenderer");
  return isRecord(owner) ? (getText(owner.title)?.trim() ?? "") : "";
};

const getPlaylistCover = (initialData: unknown) => {
  const parsed = thumbnailSchema.safeParse(
    findFirstValue(initialData, "playlistVideoThumbnailRenderer"),
  );
  if (!parsed.success || parsed.data.thumbnail.thumbnails.length === 0) return undefined;
  const coverUrl = parsed.data.thumbnail.thumbnails.reduce((largest, thumbnail) => {
    const largestArea = (largest.width ?? 0) * (largest.height ?? 0);
    const thumbnailArea = (thumbnail.width ?? 0) * (thumbnail.height ?? 0);
    return thumbnailArea >= largestArea ? thumbnail : largest;
  }).url;
  const proxyUrl = new URL("/api/youtube-cover", "http://tagium.local");
  proxyUrl.searchParams.set("url", coverUrl);
  return `${proxyUrl.pathname}${proxyUrl.search}`;
};

const getDeclaredTrackCount = (initialData: unknown) => {
  const primaryInfo = findFirstValue(initialData, "playlistSidebarPrimaryInfoRenderer");
  if (!isRecord(primaryInfo) || !Array.isArray(primaryInfo.stats)) return undefined;
  for (const stat of primaryInfo.stats) {
    const match = getText(stat)?.match(/([\d,]+)\s+videos?/i);
    if (!match) continue;
    const count = Number(match[1]?.replaceAll(",", ""));
    if (Number.isFinite(count)) return count;
  }
  return undefined;
};

const fetchContinuation = async (token: string, config: JsonRecord) => {
  const apiKey = config.INNERTUBE_API_KEY;
  const context = config.INNERTUBE_CONTEXT;
  const clientVersion = config.INNERTUBE_CLIENT_VERSION;
  if (typeof apiKey !== "string" || !isRecord(context) || typeof clientVersion !== "string") {
    return undefined;
  }

  const endpoint = new URL("/youtubei/v1/browse", YOUTUBE_ORIGIN);
  endpoint.searchParams.set("key", apiKey);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": YOUTUBE_USER_AGENT,
      "x-youtube-client-name": "1",
      "x-youtube-client-version": clientVersion,
    },
    body: JSON.stringify({ context, continuation: token }),
  });
  if (!response.ok) throw new Error(`youtube.continuation_failed (${response.status})`);
  return response.json() as Promise<unknown>;
};

const parseSourceUrl = (sourceUrl: string) => {
  const parsed = new URL(sourceUrl);
  const isYouTubeHost =
    parsed.hostname === "youtube.com" || parsed.hostname.endsWith(".youtube.com");
  const playlistId = parsed.searchParams.get("list");
  if (!isYouTubeHost || parsed.pathname.replace(/\/+$/, "") !== "/playlist" || !playlistId) {
    throw new Error("youtube.playlist_url_required");
  }
  return playlistId;
};

export default defineHandler(async (event) => {
  const requestUrl = new URL(event.req.url, "http://tagium.local");
  const sourceUrl = requestUrl.searchParams.get("url");
  if (!sourceUrl) throw new Error("youtube.url_required");

  const playlistId = parseSourceUrl(sourceUrl);
  const playlistUrl = new URL("/playlist", YOUTUBE_ORIGIN);
  playlistUrl.searchParams.set("list", playlistId);
  playlistUrl.searchParams.set("hl", "en");

  const response = await fetch(playlistUrl, {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": YOUTUBE_USER_AGENT,
    },
  });
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

      const continuation = await fetchContinuation(token, config);
      if (!continuation) break;
      collectTracks(continuation, seenVideoIds, tracks);
      if (declaredTrackCount !== undefined && tracks.length >= declaredTrackCount) break;
      collectContinuationTokens(continuation, pendingTokens);
    }
  }

  if (tracks.length === 0) throw new Error("youtube.no_resolvable_tracks");
  const year = await resolveYouTubeUploadYear(tracks[0]!.url, {
    config,
    signal: event.req.signal,
  });

  return {
    title,
    artist: getPlaylistArtist(initialData),
    genre: "",
    isAlbum: false,
    ...(year === undefined ? {} : { year }),
    coverUrl: getPlaylistCover(initialData),
    tracks,
  };
});
