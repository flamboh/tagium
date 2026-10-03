import {
  mediaKeyFromUrl,
  youtubePlaylistKey,
  youtubeVideoKey,
  type MediaScenario,
  type YouTubePlaylistScenario,
} from "../protocol.ts";
import { html, imageResponse, json } from "./assets.ts";
import { unexpected, type FakeRequest, type FakeResult } from "./types.ts";

const ytcfg = {
  INNERTUBE_API_KEY: "e2e-innertube-key",
  INNERTUBE_CLIENT_VERSION: "2.20260101.00.00",
  INNERTUBE_CONTEXT: { client: { clientName: "WEB", clientVersion: "2.20260101.00.00", hl: "en" } },
};
const ytcfgScript = `<script>ytcfg.set(${JSON.stringify(ytcfg)});</script>`;

const thumbnailUrl = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

const videoRenderer = (scenario: MediaScenario) => ({
  playlistVideoRenderer: {
    videoId: scenario.key.slice("yt:".length),
    title: { runs: [{ text: scenario.title }] },
    lengthSeconds: String(scenario.durationSec),
  },
});

const playlistPage = (request: FakeRequest, playlist: YouTubePlaylistScenario, offset: number) => {
  const videos = playlist.videoKeys
    .slice(offset, offset + playlist.pageSize)
    .map((key) => request.registry.media(key))
    .filter((video) => video !== undefined)
    .map(videoRenderer);
  const nextOffset = offset + playlist.pageSize;
  return nextOffset < playlist.videoKeys.length
    ? [
        ...videos,
        {
          continuationItemRenderer: {
            continuationEndpoint: {
              continuationCommand: { token: `${playlist.playlistId}:${nextOffset}` },
            },
          },
        },
      ]
    : videos;
};

const playlistHtml = (request: FakeRequest, playlist: YouTubePlaylistScenario) => {
  const firstVideoId = playlist.videoKeys[0]?.slice("yt:".length);
  const initialData = {
    metadata: { playlistMetadataRenderer: { title: playlist.title } },
    sidebar: {
      playlistSidebarRenderer: {
        items: [
          {
            playlistSidebarPrimaryInfoRenderer: {
              thumbnailRenderer: firstVideoId
                ? {
                    playlistVideoThumbnailRenderer: {
                      thumbnail: {
                        thumbnails: [{ url: thumbnailUrl(firstVideoId), width: 480, height: 360 }],
                      },
                    },
                  }
                : undefined,
              stats: [{ runs: [{ text: String(playlist.videoKeys.length) }, { text: " videos" }] }],
            },
          },
          {
            playlistSidebarSecondaryInfoRenderer: {
              videoOwner: { videoOwnerRenderer: { title: { runs: [{ text: playlist.author }] } } },
            },
          },
        ],
      },
    },
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      itemSectionRenderer: {
                        contents: [
                          {
                            playlistVideoListRenderer: {
                              contents: playlistPage(request, playlist, 0),
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
  return `<!doctype html><html><head>${ytcfgScript}</head><body><script>var ytInitialData = ${JSON.stringify(initialData)};</script></body></html>`;
};

const alertHtml = (text: string) => {
  const initialData = {
    alerts: [{ alertRenderer: { type: "ERROR", text: { runs: [{ text }] } } }],
  };
  return `<!doctype html><html><head>${ytcfgScript}</head><body><script>var ytInitialData = ${JSON.stringify(initialData)};</script></body></html>`;
};

type InnertubeRequestBody = { videoId?: unknown; continuation?: unknown };

const parseJsonBody = (request: FakeRequest): InnertubeRequestBody => {
  try {
    return JSON.parse(request.body ?? "{}");
  } catch {
    return {};
  }
};

export const fakeYouTube = (request: FakeRequest): FakeResult => {
  const { url, registry } = request;
  if (request.method === "GET" && url.pathname === "/") {
    return { route: "youtube.home", key: null, response: html(`<!doctype html>${ytcfgScript}`) };
  }

  if (request.method === "GET" && url.pathname === "/oembed") {
    const key = mediaKeyFromUrl(url.searchParams.get("url") ?? "");
    const scenario = registry.media(key);
    if (!scenario) return unexpected("youtube.oembed", key);
    if (scenario.metadata.kind === "status") {
      return {
        route: "youtube.oembed",
        key,
        response: new Response(scenario.metadata.status === 404 ? "Not Found" : "Unauthorized", {
          status: scenario.metadata.status,
        }),
      };
    }
    return {
      route: "youtube.oembed",
      key,
      response: json({
        title: scenario.title,
        author_name: scenario.author,
        author_url: `https://www.youtube.com/@${encodeURIComponent(scenario.author)}`,
        type: "video",
        version: "1.0",
        provider_name: "YouTube",
        provider_url: "https://www.youtube.com/",
        thumbnail_url: scenario.cover ? thumbnailUrl(scenario.key.slice("yt:".length)) : undefined,
      }),
    };
  }

  if (request.method === "POST" && url.pathname === "/youtubei/v1/next") {
    const videoId = parseJsonBody(request).videoId;
    const key = typeof videoId === "string" ? youtubeVideoKey(videoId) : null;
    const scenario = registry.media(key);
    if (!scenario) return unexpected("youtube.next", key);
    const primaryInfo =
      scenario.year === undefined
        ? { title: { runs: [{ text: scenario.title }] } }
        : {
            title: { runs: [{ text: scenario.title }] },
            dateText: { simpleText: `Jan 2, ${scenario.year}` },
          };
    return {
      route: "youtube.next",
      key,
      response: json({
        contents: {
          twoColumnWatchNextResults: {
            results: { results: { contents: [{ videoPrimaryInfoRenderer: primaryInfo }] } },
          },
        },
      }),
    };
  }

  if (request.method === "GET" && url.pathname === "/playlist") {
    const key = youtubePlaylistKey(url.searchParams.get("list") ?? "");
    const playlist = registry.get(key);
    if (playlist?.type !== "youtube-playlist") return unexpected("youtube.playlist", key);
    return {
      route: "youtube.playlist",
      key,
      response: playlist.status
        ? html("<html>unavailable</html>", playlist.status)
        : html(playlist.alert ? alertHtml(playlist.alert) : playlistHtml(request, playlist)),
    };
  }

  if (request.method === "POST" && url.pathname === "/youtubei/v1/browse") {
    const token = parseJsonBody(request).continuation;
    const [playlistId, rawOffset] = typeof token === "string" ? token.split(":") : [];
    const key = youtubePlaylistKey(playlistId ?? "");
    const playlist = registry.get(key);
    if (playlist?.type !== "youtube-playlist") return unexpected("youtube.browse", key);
    return {
      route: "youtube.browse",
      key,
      response: json({
        onResponseReceivedActions: [
          {
            appendContinuationItemsAction: {
              continuationItems: playlistPage(request, playlist, Number(rawOffset)),
            },
          },
        ],
      }),
    };
  }

  return unexpected("youtube.unknown_route");
};

export const fakeYouTubeImages = (request: FakeRequest): FakeResult => {
  const videoId = request.url.pathname.split("/")[2] ?? "";
  const key = youtubeVideoKey(videoId);
  const scenario = request.registry.media(key);
  if (!scenario) return unexpected("ytimg.thumbnail", key);
  return {
    route: "ytimg.thumbnail",
    key,
    response: scenario.cover ? imageResponse(scenario.cover) : new Response(null, { status: 404 }),
  };
};
