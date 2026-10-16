import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { mockEvent } from "h3";
import handler from "../../server/api/soundcloud-stream.post";
import { captureSentryEvents } from "./sentry-events";

type RateLimitBinding = {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
};

type RuntimeRequest = Request & {
  runtime: {
    cloudflare: {
      env: {
        TAGIUM_DEPLOY_ENV: "local" | "production";
        COBALT_SESSION_RATE_LIMITER?: RateLimitBinding;
        COBALT_CLIENT_RATE_LIMITER?: RateLimitBinding;
        SOUNDCLOUD_SESSION_RATE_LIMITER?: RateLimitBinding;
        SOUNDCLOUD_CLIENT_RATE_LIMITER?: RateLimitBinding;
      };
    };
  };
};

const limiter = (success = true) => vi.fn<RateLimitBinding["limit"]>(async () => ({ success }));

const clientId = "soundcloudTestClientId0000000000";

const homeHtml = `<script>window.__sc_version="1700000001"</script><script>window.__sc_hydration = [{"hydratable":"apiClient","data":{"id":"${clientId}"}}];</script>`;

const playlistUrl = "https://playback.media-streaming.soundcloud.cloud/x/aac_160k/y/playlist.m3u8";

const playlist = [
  "#EXTM3U",
  '#EXT-X-MAP:URI="init.mp4?sig=1"',
  "#EXTINF:10,",
  "data000.m4s?sig=2",
  "#EXTINF:2.5,",
  "data001.m4s?sig=3",
  "#EXT-X-ENDLIST",
].join("\n");

const transcoding = (preset: string) => ({
  url: `https://api-v2.soundcloud.com/media/soundcloud:tracks:1/${preset}/stream/hls`,
  preset,
  snipped: false,
  format: { protocol: "hls", mime_type: "audio/mp4" },
});

type Transcoding = ReturnType<typeof transcoding> | { format: { protocol: string } };

type TrackOverrides = {
  policy?: string;
  duration?: number;
  media?: { transcodings: Transcoding[] };
};

const trackJson = (overrides: TrackOverrides = {}) => ({
  title: "Introitus",
  duration: 12_500,
  artwork_url: "https://i1.sndcdn.com/artworks-abc-large.jpg",
  genre: "Electronic",
  display_date: "2012-04-02T14:40:38Z",
  policy: "ALLOW",
  track_authorization: "auth-token",
  user: { username: "Forss" },
  media: { transcodings: [transcoding("aac_96k"), transcoding("aac_160k")] },
  ...overrides,
});

const stubSoundCloud = (
  track: ReturnType<typeof trackJson> | Response,
  options: { playlist?: string } = {},
) => {
  const requested: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);
      requested.push(url.toString());

      if (url.hostname === "soundcloud.com") return new Response(homeHtml);

      if (url.pathname === "/resolve") {
        return track instanceof Response ? track : Response.json(track);
      }

      if (url.pathname.startsWith("/media/")) return Response.json({ url: playlistUrl });

      if (url.toString() === playlistUrl) return new Response(options.playlist ?? playlist);

      return new Response(null, { status: 599 });
    }),
  );

  return requested;
};

const makeRequest = (
  url = "https://soundcloud.com/forss/introitus",
  origin = "https://tagium.test",
) => {
  const request = new Request("https://tagium.test/api/soundcloud-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "X-Tagium-Request-Id": "req-1" },
    body: JSON.stringify({ url }),
  }) as RuntimeRequest;

  request.runtime = { cloudflare: { env: { TAGIUM_DEPLOY_ENV: "local" } } };

  return request;
};

const call = (request = makeRequest()) => handler(mockEvent(request)) as Promise<Response>;

describe("soundcloud stream endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves the aac_160k playlist into init and segment urls with provider metadata", async () => {
    const requested = stubSoundCloud(trackJson());

    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Tagium-Request-Id")).toBe("req-1");
    expect(await response.json()).toEqual({
      initUrl: "https://playback.media-streaming.soundcloud.cloud/x/aac_160k/y/init.mp4?sig=1",
      segmentUrls: [
        "https://playback.media-streaming.soundcloud.cloud/x/aac_160k/y/data000.m4s?sig=2",
        "https://playback.media-streaming.soundcloud.cloud/x/aac_160k/y/data001.m4s?sig=3",
      ],
      durationMs: 12_500,
      metadata: {
        title: "Introitus",
        artist: "Forss",
        album_artist: "Forss",
        genre: "Electronic",
        date: "2012-04-02",
      },
      coverUrl: "https://i1.sndcdn.com/artworks-abc-t1080x1080.jpg",
    });

    const streamRequest = new URL(requested.find((url) => url.includes("/media/"))!);
    expect(streamRequest.pathname).toContain("/aac_160k/");
    expect(streamRequest.searchParams.get("client_id")).toBe(clientId);
    expect(streamRequest.searchParams.get("track_authorization")).toBe("auth-token");
  });

  it("admits requests through the soundcloud rate limiters instead of cobalt's", async () => {
    stubSoundCloud(trackJson());

    const limiters = {
      COBALT_SESSION_RATE_LIMITER: { limit: limiter() },
      COBALT_CLIENT_RATE_LIMITER: { limit: limiter() },
      SOUNDCLOUD_SESSION_RATE_LIMITER: { limit: limiter() },
      SOUNDCLOUD_CLIENT_RATE_LIMITER: { limit: limiter() },
    };

    const request = makeRequest();
    request.headers.set("cf-connecting-ip", "203.0.113.9");
    request.runtime.cloudflare.env = { TAGIUM_DEPLOY_ENV: "production", ...limiters };

    const response = await call(request);

    expect(response.status).toBe(200);
    expect(limiters.SOUNDCLOUD_SESSION_RATE_LIMITER.limit).toHaveBeenCalledOnce();
    expect(limiters.SOUNDCLOUD_CLIENT_RATE_LIMITER.limit).toHaveBeenCalledWith({
      key: "203.0.113.9",
    });
    expect(limiters.COBALT_SESSION_RATE_LIMITER.limit).not.toHaveBeenCalled();
    expect(limiters.COBALT_CLIENT_RATE_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("rate limits on the soundcloud session limiter before contacting soundcloud", async () => {
    const requested = stubSoundCloud(trackJson());
    const request = makeRequest();
    request.runtime.cloudflare.env = {
      TAGIUM_DEPLOY_ENV: "production",
      COBALT_SESSION_RATE_LIMITER: { limit: limiter() },
      COBALT_CLIENT_RATE_LIMITER: { limit: limiter() },
      SOUNDCLOUD_SESSION_RATE_LIMITER: { limit: limiter(false) },
      SOUNDCLOUD_CLIENT_RATE_LIMITER: { limit: limiter() },
    };

    const response = await call(request);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(requested).toEqual([]);
  });

  it("fails closed in production when only the cobalt limiters are bound", async () => {
    const requested = stubSoundCloud(trackJson());
    const request = makeRequest();
    request.runtime.cloudflare.env = {
      TAGIUM_DEPLOY_ENV: "production",
      COBALT_SESSION_RATE_LIMITER: { limit: limiter() },
      COBALT_CLIENT_RATE_LIMITER: { limit: limiter() },
    };

    const response = await call(request);

    expect(response.status).toBe(503);
    expect(requested).toEqual([]);
  });

  it("rejects cross-origin requests before contacting soundcloud", async () => {
    const requested = stubSoundCloud(trackJson());

    const response = await call(makeRequest(undefined, "https://evil.test"));

    expect(response.status).toBe(403);
    expect(requested).toHaveLength(0);
  });

  it("rejects links that are not soundcloud tracks", async () => {
    const requested = stubSoundCloud(trackJson());

    const response = await call(makeRequest("https://soundcloud.com/forss/sets/ecclesia"));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("error.api.link.unsupported");
    expect(requested).toHaveLength(0);
  });

  it.each([
    [{ policy: "BLOCK" }, "error.api.content.region"],
    [{ policy: "SNIP" }, "error.api.content.paid"],
    [{ duration: 10_800_001 }, "error.api.content.too_long"],
  ])("maps %o to %s as a warning", async (overrides, code) => {
    stubSoundCloud(trackJson(overrides));
    let response: Response | undefined;

    const events = await captureSentryEvents(async () => {
      response = await call();
    });

    expect(response?.status).toBe(502);
    expect(await response?.text()).toBe(code);
    expect(events).toMatchObject([
      { level: "warning", tags: { route: "soundcloud_stream", stage: "soundcloud.track.policy" } },
    ]);
  });

  it("reports a missing playable stream as an error-level event", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubSoundCloud(trackJson({ media: { transcodings: [transcoding("abr_sq")] } }));
    let response: Response | undefined;

    const events = await captureSentryEvents(async () => {
      response = await call();
    });

    expect(await response?.text()).toBe("error.api.soundcloud.no_stream");
    expect(events).toMatchObject([
      {
        level: "error",
        message: "soundcloud soundcloud_stream failed: error.api.soundcloud.no_stream",
        tags: { service: "soundcloud", stage: "soundcloud.stream.select" },
      },
    ]);
  });

  it("reports tracks with only encrypted streams as a drm warning", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubSoundCloud(
      trackJson({
        media: {
          transcodings: [{ ...transcoding("aac_160k"), format: { protocol: "ctr-encrypted-hls" } }],
        },
      }),
    );
    let response: Response | undefined;

    const events = await captureSentryEvents(async () => {
      response = await call();
    });

    expect(await response?.text()).toBe("error.api.soundcloud.maybe_drm");
    expect(events.map((event) => event.level)).toEqual(["warning"]);
  });

  it("reports unusable playlists as an error-level event", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubSoundCloud(trackJson(), { playlist: "#EXTM3U\n#EXTINF:1,\nseg.m4s" });
    let response: Response | undefined;

    const events = await captureSentryEvents(async () => {
      response = await call();
    });

    expect(await response?.text()).toBe("error.api.fetch.empty");
    expect(events).toMatchObject([
      { level: "error", tags: { stage: "soundcloud.stream.playlist_parse" } },
    ]);
    expect(warn.mock.calls.map(([entry]) => JSON.parse(entry))).toContainEqual(
      expect.objectContaining({
        event: "soundcloud_upstream_failure",
        stage: "stream.playlist_parse",
        reason: "init",
        requestId: "req-1",
      }),
    );
  });

  it("returns missing tracks as unavailable without alerting", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubSoundCloud(new Response("{}", { status: 404 }));
    let response: Response | undefined;

    const events = await captureSentryEvents(async () => {
      response = await call();
    });

    expect(await response?.text()).toBe("error.api.content.post.unavailable");
    expect(events).toHaveLength(0);
  });
});
