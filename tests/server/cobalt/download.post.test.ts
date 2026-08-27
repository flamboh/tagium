import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { HTTPError } from "nitro";
import { mockEvent } from "h3";
import handler from "../../../server/api/cobalt/download.post";
import { resetRateLimitBuckets } from "../../../server/utils/dev-controls";

type RateLimitBinding = {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
};

type RequestBodyValue = string | boolean;

type RuntimeEnv = {
  COBALT_API_URL: string;
  COBALT_API_KEY?: string;
  COBALT_MACHINE_AFFINITY_SECRET: string;
  COBALT_SESSION_RATE_LIMITER?: RateLimitBinding;
  COBALT_CLIENT_RATE_LIMITER?: RateLimitBinding;
  TAGIUM_DEPLOY_ENV: "local" | "preview" | "production";
};

type RuntimeRequest = Request & {
  runtime: { cloudflare: { env: RuntimeEnv } };
};

const machineAffinitySecret = "test-machine-affinity-secret";
const sourceUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const successfulProxyPlan = () => ({
  status: "local-processing",
  type: "proxy",
  service: "youtube",
  tunnel: ["https://cobalt.test/tunnel?id=123456789012345678901"],
  output: { type: "video/mp4", filename: "video.mp4" },
});

const makeRequest = (
  body: Record<string, RequestBodyValue> = { url: sourceUrl },
  options: {
    cookie?: string;
    clientIp?: string;
    origin?: string;
    runtime?: Partial<RuntimeEnv>;
  } = {},
) => {
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: options.origin ?? "https://tagium.test",
    "X-Tagium-Request-Id": "request-test",
  });
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.clientIp) headers.set("CF-Connecting-IP", options.clientIp);

  const request = new Request("https://tagium.test/api/cobalt/download", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as RuntimeRequest;

  request.runtime = {
    cloudflare: {
      env: {
        COBALT_API_URL: "https://cobalt.test/",
        COBALT_MACHINE_AFFINITY_SECRET: machineAffinitySecret,
        TAGIUM_DEPLOY_ENV: "local",
        ...options.runtime,
      },
    },
  };
  return request;
};

const makeEvent = (request: RuntimeRequest) => mockEvent(request);

const createRateLimitBinding = (limit: number): RateLimitBinding => {
  const counts = new Map<string, number>();
  return {
    limit: async ({ key }) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    },
  };
};

describe("cobalt video download endpoint", () => {
  afterEach(() => {
    resetRateLimitBuckets();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects invalid bodies before contacting Cobalt", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await handler(
      makeEvent(makeRequest({ url: "not a URL", downloadMode: "everything" })),
    ).catch((cause) => cause);

    expect(HTTPError.isError(error)).toBe(true);
    expect(error).toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allowlists options and always forces proxyable local processing", async () => {
    let upstreamBody: Record<string, string | boolean> | undefined;
    let upstreamHeaders: Headers | undefined;
    const videoTunnel =
      "https://cobalt.test/tunnel?id=123456789012345678901&exp=1234567890123&sig=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&sec=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&iv=cccccccccccccccccccccc";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        upstreamBody = JSON.parse(typeof init?.body === "string" ? init.body : "") as Record<
          string,
          string | boolean
        >;
        upstreamHeaders = new Headers(init?.headers);
        return Response.json(
          {
            status: "local-processing",
            type: "merge",
            service: "youtube",
            tunnel: [videoTunnel],
            output: { type: "video/mp4", filename: "download.mp4" },
          },
          { headers: { "X-Cobalt-Machine-Id": "cobalt-machine-1" } },
        );
      }),
    );

    const request = makeRequest(
      {
        url: sourceUrl,
        downloadMode: "auto",
        videoQuality: "720",
        youtubeVideoCodec: "h264",
        youtubeVideoContainer: "mp4",
        audioFormat: "opus",
        audioBitrate: "8",
        filenameStyle: "pretty",
        subtitleLang: "en",
        youtubeDubLang: "en-US",
        disableMetadata: false,
        allowH265: true,
        convertGif: false,
        tiktokFullAudio: true,
        youtubeHLS: true,
        youtubeBetterAudio: true,
        alwaysProxy: false,
        localProcessing: "disabled",
        ignoredOption: "must not reach Cobalt",
      },
      {
        cookie: "tagium_client_id=session-1",
        clientIp: "203.0.113.10",
        runtime: { COBALT_API_KEY: "server-secret" },
      },
    );
    request.headers.set("X-Tagium-Import-Id", "import-1");
    request.headers.set("X-Tagium-Track-Index", "7");

    const response = await handler(makeEvent(request));
    const body = await response.json();
    const tunnelUrl = new URL(body.tunnel[0], request.url);

    expect(response.status).toBe(200);
    expect(upstreamBody).toMatchObject({
      url: sourceUrl,
      downloadMode: "auto",
      videoQuality: "720",
      youtubeVideoCodec: "h264",
      youtubeVideoContainer: "mp4",
      audioFormat: "opus",
      audioBitrate: "8",
      alwaysProxy: true,
      localProcessing: "forced",
      youtubeHLS: false,
    });
    expect(upstreamBody).not.toHaveProperty("ignoredOption");
    expect(upstreamHeaders?.get("Authorization")).toBe("Api-Key server-secret");
    expect(response.headers.get("Authorization")).toBeNull();
    expect(upstreamHeaders?.get("X-Tagium-Request-Id")).toBe("request-test");
    expect(upstreamHeaders?.get("X-Tagium-Import-Id")).toBe("import-1");
    expect(upstreamHeaders?.get("X-Tagium-Track-Index")).toBe("7");
    expect(upstreamHeaders?.get("X-Tagium-Source-Fingerprint")).toMatch(/^sha256:[a-f0-9]{32}$/);
    expect(tunnelUrl.pathname).toBe("/api/cobalt/tunnel");
    expect(tunnelUrl.searchParams.get("url")).toBe(videoTunnel);
    expect(tunnelUrl.searchParams.get("kind")).toBe("video");
    expect(tunnelUrl.searchParams.get("machine")).toBe("cobalt-machine-1");
    expect(tunnelUrl.searchParams.get("signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(tunnelUrl.searchParams.get("parentRequestId")).toBe("request-test");
    expect(tunnelUrl.searchParams.get("importId")).toBe("import-1");
    expect(tunnelUrl.searchParams.get("trackIndex")).toBe("7");
  });

  it("rewrites picker downloads through same-origin proxies", async () => {
    const cobaltTunnel = "https://cobalt.test/tunnel?id=123456789012345678901";
    const directImage = "https://cdn.example.test/photo.jpg";
    const directAudio = "https://cdn.example.test/post-audio.mp3";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            status: "picker",
            picker: [
              { type: "video", url: cobaltTunnel, thumb: cobaltTunnel },
              { type: "photo", url: directImage, thumb: directImage },
            ],
            audio: directAudio,
            audioFilename: "post_audio.mp3",
          },
          { headers: { "X-Cobalt-Machine-Id": "cobalt-machine-1" } },
        ),
      ),
    );

    const response = await handler(
      makeEvent(makeRequest({ url: "https://www.instagram.com/p/example/" })),
    );
    const body = await response.json();
    const pickerUrls = body.picker.map(
      (item: { url: string }) => new URL(item.url, "https://tagium.test"),
    );
    const pickerThumbs = body.picker.map(
      (item: { thumb: string }) => new URL(item.thumb, "https://tagium.test"),
    );
    const audioUrl = new URL(body.audio, "https://tagium.test");

    expect(response.status).toBe(200);
    expect(body.picker).toHaveLength(2);
    expect(pickerUrls[0].pathname).toBe("/api/cobalt/tunnel");
    expect(pickerThumbs[0].pathname).toBe("/api/cobalt/tunnel");
    expect(pickerUrls[1].pathname).toBe("/api/cobalt/tunnel");
    expect(pickerUrls[1].searchParams.get("url")).toBe(directImage);
    expect(pickerUrls[1].searchParams.get("resource")).toBe("direct");
    expect(pickerUrls[1].searchParams.get("expires")).toMatch(/^\d{10}$/);
    expect(pickerUrls[1].searchParams.get("signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(pickerThumbs[1].toString()).toBe(directImage);
    expect(audioUrl.pathname).toBe("/api/cobalt/tunnel");
    expect(audioUrl.searchParams.get("url")).toBe(directAudio);
    expect(audioUrl.searchParams.get("resource")).toBe("direct");
    expect(audioUrl.searchParams.get("expires")).toMatch(/^\d{10}$/);
    expect(audioUrl.searchParams.get("signature")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("leaves an ordinary redirect untouched", async () => {
    const redirectUrl = "https://cdn.example.test/download/video.mp4";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ status: "redirect", url: redirectUrl, filename: "video.mp4" }),
      ),
    );

    const response = await handler(makeEvent(makeRequest()));
    await expect(response.json()).resolves.toEqual({
      status: "redirect",
      url: redirectUrl,
      filename: "video.mp4",
    });
  });

  it("rejects non-http urls returned by Cobalt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ status: "redirect", url: "javascript:alert(1)", filename: "video.mp4" }),
      ),
    );

    const response = await handler(makeEvent(makeRequest()));

    expect(response.status).toBe(502);
  });

  it("rejects HLS tunnels that would run processing on Cobalt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "tunnel",
          url: "https://cobalt.test/tunnel?id=123456789012345678901",
          filename: "video.mp4",
        }),
      ),
    );

    const response = await handler(makeEvent(makeRequest()));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      error: { code: "error.api.service.unsupported" },
    });
  });

  it("rejects video quality above the server cap", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await handler(
      makeEvent(makeRequest({ url: sourceUrl, videoQuality: "2160" })),
    ).catch((cause) => cause);

    expect(HTTPError.isError(error)).toBe(true);
    expect(error).toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns typed upstream errors and preserves capacity retry hints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { status: "error", error: { code: "error.api.capacity_exceeded" } },
          { status: 503, headers: { "Retry-After": "9" } },
        ),
      ),
    );

    const response = await handler(makeEvent(makeRequest()));

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("9");
    expect(response.headers.get("X-Tagium-Request-Id")).toBe("request-test");
    await expect(response.json()).resolves.toEqual({
      status: "error",
      error: { code: "error.api.capacity_exceeded" },
    });
  });

  it("uses Tagium's shared Cloudflare admission policy before resolving", async () => {
    const sessionLimiter = createRateLimitBinding(20);
    const clientLimiter = createRateLimitBinding(60);
    const fetchMock = vi.fn(async () => Response.json(successfulProxyPlan()));
    vi.stubGlobal("fetch", fetchMock);

    const responses: Response[] = [];
    for (let index = 0; index < 21; index += 1) {
      responses.push(
        await handler(
          makeEvent(
            makeRequest(
              { url: sourceUrl },
              {
                cookie: "tagium_client_id=session-1",
                clientIp: "203.0.113.10",
                runtime: {
                  COBALT_SESSION_RATE_LIMITER: sessionLimiter,
                  COBALT_CLIENT_RATE_LIMITER: clientLimiter,
                },
              },
            ),
          ),
        ),
      );
    }

    expect(responses.slice(0, 20).every((response) => response.status === 200)).toBe(true);
    expect(responses[20]?.status).toBe(429);
    expect(responses[20]?.headers.get("Retry-After")).toBe("60");
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it("uses Tagium's permissive local admission when bindings are absent", async () => {
    const fetchMock = vi.fn(async () => Response.json(successfulProxyPlan()));
    vi.stubGlobal("fetch", fetchMock);

    const responses: Response[] = [];
    for (let index = 0; index < 5; index += 1) {
      responses.push(
        await handler(
          makeEvent(
            makeRequest(
              { url: sourceUrl },
              { cookie: "tagium_client_id=session-1", clientIp: "203.0.113.10" },
            ),
          ),
        ),
      );
    }

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("fails closed outside local development when shared bindings are missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await handler(
      makeEvent(makeRequest({ url: sourceUrl }, { runtime: { TAGIUM_DEPLOY_ENV: "production" } })),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires same-origin requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await handler(
      makeEvent(makeRequest({ url: sourceUrl }, { origin: "https://evil.example.test" })),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Download origin is not allowed.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
