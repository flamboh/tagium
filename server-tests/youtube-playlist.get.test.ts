import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import handler from "../server/api/youtube-playlist.get";

const sourceUrl = "https://www.youtube.com/playlist?list=PLESiES1i-ThqUjxot6jWLDu90fxtkcpA0";

const makeEvent = (url = sourceUrl) => {
  const request = new Request(
    `https://tagium.test/api/youtube-playlist?url=${encodeURIComponent(url)}`,
  );
  return { req: request } as unknown as Parameters<typeof handler>[0];
};

const lockupVideo = (videoId: string, title: string, duration: string) => ({
  lockupViewModel: {
    contentId: videoId,
    contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
    contentImage: {
      thumbnailViewModel: {
        overlays: [
          {
            thumbnailBottomOverlayViewModel: {
              badges: [{ thumbnailBadgeViewModel: { text: duration } }],
            },
          },
        ],
      },
    },
    metadata: {
      lockupMetadataViewModel: {
        title: { content: title },
      },
    },
  },
});

describe("youtube playlist endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves current and legacy YouTube playlist entries across continuations", async () => {
    const initialData = {
      metadata: {
        playlistMetadataRenderer: { title: " Test Playlist " },
      },
      sidebar: {
        playlistSidebarRenderer: {
          items: [
            {
              playlistSidebarPrimaryInfoRenderer: {
                stats: [{ runs: [{ text: "3" }, { text: " videos" }] }],
                thumbnailRenderer: {
                  playlistVideoThumbnailRenderer: {
                    thumbnail: {
                      thumbnails: [
                        { url: "https://i.ytimg.com/small.jpg", width: 120, height: 90 },
                        { url: "https://i.ytimg.com/large.jpg", width: 1280, height: 720 },
                      ],
                    },
                  },
                },
              },
            },
            {
              playlistSidebarSecondaryInfoRenderer: {
                videoOwner: {
                  videoOwnerRenderer: {
                    title: { runs: [{ text: "Playlist Owner" }] },
                  },
                },
              },
            },
          ],
        },
      },
      contents: [
        lockupVideo("first-video", "First Track", "4:14"),
        lockupVideo("second-video", "Second Track", "1:02:03"),
        { continuationItemRenderer: { continuationCommand: { token: "next-page" } } },
      ],
    };
    const html = [
      `<script>var ytInitialData = ${JSON.stringify(initialData)};</script>`,
      `<script>ytcfg.set("EMERGENCY_BASE_URL", "/error"); window.onerror = function() { window.failed = true; };</script>`,
      `<script>ytcfg.set(${JSON.stringify({
        INNERTUBE_API_KEY: "api-key",
        INNERTUBE_CLIENT_VERSION: "2.20260708.00.00",
        INNERTUBE_CONTEXT: { client: { clientName: "WEB" } },
      })});</script>`,
    ].join("");

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : new URL(input).toString();
      if (url.startsWith("https://www.youtube.com/playlist?")) {
        expect(url).toContain("list=PLESiES1i-ThqUjxot6jWLDu90fxtkcpA0");
        return new Response(html);
      }
      if (url.startsWith("https://www.youtube.com/youtubei/v1/next?")) {
        expect(typeof init?.body).toBe("string");
        expect(JSON.parse(init?.body as string)).toMatchObject({ videoId: "first-video" });
        return Response.json({
          contents: {
            twoColumnWatchNextResults: {
              results: {
                results: {
                  contents: [
                    { videoPrimaryInfoRenderer: { dateText: { simpleText: "Aug 14, 2022" } } },
                  ],
                },
              },
            },
          },
        });
      }

      expect(url).toContain("https://www.youtube.com/youtubei/v1/browse?key=api-key");
      expect(typeof init?.body).toBe("string");
      expect(JSON.parse(init?.body as string)).toMatchObject({ continuation: "next-page" });
      return Response.json({
        continuationContents: {
          playlistVideoListContinuation: {
            contents: [
              {
                playlistVideoRenderer: {
                  videoId: "third-video",
                  title: { runs: [{ text: "Third Track" }] },
                  lengthSeconds: "65",
                },
              },
            ],
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(handler(makeEvent())).resolves.toEqual({
      title: "Test Playlist",
      artist: "Playlist Owner",
      genre: "",
      isAlbum: false,
      year: 2022,
      coverUrl: "https://i.ytimg.com/large.jpg",
      tracks: [
        {
          title: "First Track",
          url: "https://www.youtube.com/watch?v=first-video",
          duration: 254,
          trackNumber: 1,
        },
        {
          title: "Second Track",
          url: "https://www.youtube.com/watch?v=second-video",
          duration: 3723,
          trackNumber: 2,
        },
        {
          title: "Third Track",
          url: "https://www.youtube.com/watch?v=third-video",
          duration: 65,
          trackNumber: 3,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects non-playlist YouTube URLs without fetching them", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(handler(makeEvent("https://www.youtube.com/watch?v=video"))).rejects.toThrow(
      "youtube.playlist_url_required",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
