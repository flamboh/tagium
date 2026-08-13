import { Schema } from "effect";

export const YOUTUBE_ORIGIN = "https://www.youtube.com";
export const YOUTUBE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

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

type YouTubeRequestStage = "config" | "continuation" | "playlist" | "upload_year";

const MAX_YOUTUBE_FETCH_ATTEMPTS = 2;
const YOUTUBE_RETRY_DELAY_MS = 100;
const TRANSIENT_YOUTUBE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const isRecord = Schema.is(jsonRecordSchema);
const isJsonArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value);
const isString = Schema.is(Schema.String);
const decodeJson = Schema.decodeUnknownSync(jsonValueSchema);

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const logYouTubeUpstreamFailure = (
  stage: YouTubeRequestStage,
  attempt: number,
  retrying: boolean,
  details: { errorType?: string; status?: number },
) => {
  console.warn(
    JSON.stringify({
      event: "youtube_upstream_failure",
      stage,
      attempt,
      retrying,
      ...details,
    }),
  );
};

export const fetchYouTubeWithRetry = async (
  input: string | URL | Request,
  init: RequestInit,
  options: {
    stage: YouTubeRequestStage;
    fetch?: typeof globalThis.fetch;
  },
) => {
  const fetch = options.fetch ?? globalThis.fetch;

  for (let attempt = 1; attempt <= MAX_YOUTUBE_FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(input, init);
      if (response.ok) return response;

      const retrying =
        attempt < MAX_YOUTUBE_FETCH_ATTEMPTS && TRANSIENT_YOUTUBE_STATUSES.has(response.status);
      logYouTubeUpstreamFailure(options.stage, attempt, retrying, { status: response.status });
      if (!retrying) return response;

      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      const retrying =
        attempt < MAX_YOUTUBE_FETCH_ATTEMPTS &&
        !(error instanceof Error && error.name === "AbortError");
      logYouTubeUpstreamFailure(options.stage, attempt, retrying, {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      if (!retrying) throw error;
    }

    await wait(YOUTUBE_RETRY_DELAY_MS);
  }

  throw new Error("youtube.retry_exhausted");
};

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

export const extractYouTubeJsonObject = (source: string, marker: string, startAt = 0) => {
  const markerIndex = source.indexOf(marker, startAt);
  if (markerIndex < 0) return undefined;
  let objectStart = markerIndex + marker.length;
  while (/\s/.test(source[objectStart] ?? "")) objectStart++;
  if (source[objectStart] !== "{") return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = objectStart; index < source.length; index++) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth++;
    if (character === "}") {
      depth--;
      if (depth === 0) {
        return {
          value: decodeJson(JSON.parse(source.slice(objectStart, index + 1))),
          end: index + 1,
        };
      }
    }
  }
  return undefined;
};

export const getYouTubeConfig = (html: string) => {
  const config: JsonRecord = {};
  let offset = 0;
  while (true) {
    const markerIndex = html.indexOf("ytcfg.set(", offset);
    if (markerIndex < 0) break;
    offset = markerIndex + "ytcfg.set(".length;

    let extracted: ReturnType<typeof extractYouTubeJsonObject>;
    try {
      extracted = extractYouTubeJsonObject(html, "ytcfg.set(", markerIndex);
    } catch {
      continue;
    }
    if (!extracted) continue;
    if (isRecord(extracted.value)) Object.assign(config, extracted.value);
    offset = extracted.end;
  }
  return config;
};

export const getYouTubeVideoId = (sourceUrl: string) => {
  try {
    const url = new URL(sourceUrl);
    const pathParts = url.pathname.split("/").filter(Boolean);
    let videoId: string | undefined;

    if (url.hostname === "youtu.be") {
      videoId = pathParts[0];
    } else {
      const isYouTubeHost = [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
      ].includes(url.hostname.toLowerCase());
      if (!isYouTubeHost) return undefined;

      if (pathParts[0] === "watch") {
        videoId = url.searchParams.get("v") ?? pathParts[1];
      } else if (["embed", "live", "shorts", "v"].includes(pathParts[0] ?? "")) {
        videoId = pathParts[1];
      }
    }

    return videoId && videoIdPattern.test(videoId) ? videoId : undefined;
  } catch {
    return undefined;
  }
};

const yearFromDate = (date: string | undefined) => {
  const match = date?.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  if (!match) return undefined;
  const year = Number(match[1]);
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : undefined;
};

export const resolveYouTubeUploadYear = async (
  sourceUrl: string,
  options: {
    config?: JsonRecord;
    fetch?: typeof globalThis.fetch;
    signal?: AbortSignal;
  } = {},
) => {
  const videoId = getYouTubeVideoId(sourceUrl);
  if (!videoId) return undefined;
  const fetch = options.fetch ?? globalThis.fetch;

  let config = options.config;
  if (!config) {
    const homepageResponse = await fetchYouTubeWithRetry(
      YOUTUBE_ORIGIN,
      {
        headers: { "user-agent": YOUTUBE_USER_AGENT },
        signal: options.signal,
      },
      { fetch, stage: "config" },
    );
    if (!homepageResponse.ok) {
      throw new Error(`youtube.config_failed (${homepageResponse.status})`);
    }
    config = getYouTubeConfig(await homepageResponse.text());
  }

  const apiKey = config.INNERTUBE_API_KEY;
  const context = config.INNERTUBE_CONTEXT;
  const clientVersion = config.INNERTUBE_CLIENT_VERSION;
  if (!isString(apiKey) || !isRecord(context) || !isString(clientVersion)) {
    return undefined;
  }

  const nextUrl = new URL("/youtubei/v1/next", YOUTUBE_ORIGIN);
  nextUrl.searchParams.set("prettyPrint", "false");
  nextUrl.searchParams.set("key", apiKey);
  const response = await fetchYouTubeWithRetry(
    nextUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": YOUTUBE_USER_AGENT,
        "x-youtube-client-name": "1",
        "x-youtube-client-version": clientVersion,
      },
      body: JSON.stringify({ videoId, context }),
      signal: options.signal,
    },
    { fetch, stage: "upload_year" },
  );
  if (!response.ok) throw new Error(`youtube.video_failed (${response.status})`);

  const data = decodeJson(await response.json());
  const primaryInfo = (() => {
    if (!isRecord(data)) return undefined;
    const contents = data.contents;
    if (!isRecord(contents)) return undefined;
    const watchResults = contents.twoColumnWatchNextResults;
    if (!isRecord(watchResults)) return undefined;
    const results = watchResults.results;
    if (!isRecord(results) || !isRecord(results.results)) return undefined;
    const resultContents = results.results.contents;
    if (!isJsonArray(resultContents)) return undefined;
    for (const entry of resultContents) {
      if (!isRecord(entry)) continue;
      const candidate = entry.videoPrimaryInfoRenderer;
      if (candidate !== undefined && isRecord(candidate)) return candidate;
    }
    return undefined;
  })();
  if (!primaryInfo || !isRecord(primaryInfo.dateText)) return undefined;
  const dateText = primaryInfo.dateText.simpleText;
  return yearFromDate(isString(dateText) ? dateText : undefined);
};
