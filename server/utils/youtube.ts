import { z } from "zod";

export const YOUTUBE_ORIGIN = "https://www.youtube.com";
export const YOUTUBE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const YOUTUBE_WEB_CLIENT_VERSION = "2.20240101.00.00";

const playerResponseSchema = z
  .object({
    microformat: z
      .object({
        playerMicroformatRenderer: z
          .object({
            uploadDate: z.string().optional(),
            publishDate: z.string().optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

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
          value: JSON.parse(source.slice(objectStart, index + 1)) as unknown,
          end: index + 1,
        };
      }
    }
  }
  return undefined;
};

export const getYouTubeVideoId = (sourceUrl: string) => {
  try {
    const url = new URL(sourceUrl);
    const pathParts = url.pathname.split("/").filter(Boolean);
    let videoId: string | undefined;

    if (url.hostname === "youtu.be") {
      videoId = pathParts[0];
    } else {
      const isYouTubeHost = url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com");
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
  const match = date?.match(/^(\d{4})-/);
  if (!match) return undefined;
  const year = Number(match[1]);
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : undefined;
};

export const resolveYouTubeUploadYear = async (
  sourceUrl: string,
  options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {},
) => {
  const videoId = getYouTubeVideoId(sourceUrl);
  if (!videoId) return undefined;

  const playerUrl = new URL("/youtubei/v1/player", YOUTUBE_ORIGIN);
  playerUrl.searchParams.set("prettyPrint", "false");
  const response = await (options.fetch ?? globalThis.fetch)(playerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": YOUTUBE_USER_AGENT,
      "x-youtube-client-name": "1",
      "x-youtube-client-version": YOUTUBE_WEB_CLIENT_VERSION,
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: "WEB",
          clientVersion: YOUTUBE_WEB_CLIENT_VERSION,
          hl: "en",
          gl: "US",
        },
      },
    }),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`youtube.video_failed (${response.status})`);

  const playerResponse = playerResponseSchema.safeParse(await response.json());
  if (!playerResponse.success) return undefined;

  const microformat = playerResponse.data.microformat.playerMicroformatRenderer;
  return yearFromDate(microformat.uploadDate) ?? yearFromDate(microformat.publishDate);
};
