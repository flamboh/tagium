import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { HTTPError } from "nitro";
import handler from "../../server/api/cobalt/audio.post";

type RuntimeRequest = Request & {
  runtime: {
    cloudflare: {
      env: {
        COBALT_API_URL: string;
        COBALT_MACHINE_AFFINITY_SECRET: string;
        COBALT_SESSION_RATE_LIMITER?: RateLimitBinding;
        COBALT_CLIENT_RATE_LIMITER?: RateLimitBinding;
        TAGIUM_DEPLOY_ENV: "local" | "preview" | "production";
      };
    };
  };
};

type RateLimitBinding = {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
};

const machineAffinitySecret = "test-machine-affinity-secret";

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

const makeAudioRequest = (signal?: AbortSignal, year: number | null = 2020) => {
  const request = new Request("https://tagium.test/api/cobalt/audio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://tagium.test",
    },
    body: JSON.stringify({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      audioBitrate: "128",
      ...(year === null ? {} : { year }),
    }),
    signal,
  }) as RuntimeRequest;

  request.runtime = {
    cloudflare: {
      env: {
        COBALT_API_URL: "https://cobalt.test/",
        COBALT_MACHINE_AFFINITY_SECRET: machineAffinitySecret,
        TAGIUM_DEPLOY_ENV: "local",
      },
    },
  };

  return request;
};

const makeEvent = (request: RuntimeRequest) => {
  return { req: request } as unknown as Parameters<typeof handler>[0];
};

describe("cobalt audio endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps invalid request bodies to HTTP 400 errors", async () => {
    const request = makeAudioRequest();
    const invalidRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        url: "not a URL",
        audioBitrate: "lossless",
        year: 99,
      }),
    }) as RuntimeRequest;
    invalidRequest.runtime = request.runtime;

    const error = await handler(makeEvent(invalidRequest)).catch((cause) => cause);

    expect(HTTPError.isError(error)).toBe(true);
    expect(error).toMatchObject({ status: 400 });
    expect(error.message).toContain('["url"]');
  });

  it("requests non-HLS Cobalt audio", async () => {
    const cobaltBodies: unknown[] = [];
    const audioTunnel =
      "https://cobalt.test/tunnel?id=123456789012345678901&exp=1234567890123&sig=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&sec=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&iv=cccccccccccccccccccccc";
    const coverTunnel =
      "https://cobalt.test/tunnel?id=223456789012345678901&exp=1234567890123&sig=ddddddddddddddddddddddddddddddddddddddddddd&sec=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee&iv=ffffffffffffffffffffff";
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      cobaltBodies.push(JSON.parse(init?.body as string));

      return Response.json({
        status: "local-processing",
        type: "audio",
        service: "youtube",
        tunnel: [audioTunnel, coverTunnel],
        output: {
          type: "audio/mpeg",
          filename: "download.mp3",
          metadata: {
            title: "Download",
          },
        },
        audio: {
          copy: false,
          format: "mp3",
          bitrate: "128",
          cover: true,
          futureAudioField: "ignored",
        },
        futureResponseField: { nested: true },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(makeEvent(makeAudioRequest()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(cobaltBodies).toMatchObject([{ youtubeHLS: false }]);
    expect(body).toMatchObject({
      status: "local-processing",
      tunnel: [
        `/api/cobalt/tunnel?url=${encodeURIComponent(audioTunnel)}`,
        `/api/cobalt/tunnel?url=${encodeURIComponent(coverTunnel)}`,
      ],
      output: {
        filename: "download.mp3",
        metadata: {
          date: "2020",
        },
      },
    });
  });

  it("classifies malformed upstream payloads as gateway failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ status: "a-future-cobalt-status" })),
    );

    const response = await handler(makeEvent(makeAudioRequest()));

    expect(response.status).toBe(502);
    expect(await response.text()).toContain("a-future-cobalt-status");
  });

  it("infers direct YouTube track year from its upload date", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : new URL(input).toString();
      if (url === "https://www.youtube.com/") {
        return new Response(
          `<script>ytcfg.set(${JSON.stringify({
            INNERTUBE_API_KEY: "api-key",
            INNERTUBE_CLIENT_VERSION: "2.20260708.00.00",
            INNERTUBE_CONTEXT: { client: { clientName: "WEB" } },
          })});</script>`,
        );
      }
      if (url.startsWith("https://www.youtube.com/youtubei/v1/next?")) {
        return Response.json({
          contents: {
            twoColumnWatchNextResults: {
              results: {
                results: {
                  contents: [
                    { videoPrimaryInfoRenderer: { dateText: { simpleText: "Oct 25, 1987" } } },
                  ],
                },
              },
            },
          },
        });
      }

      return Response.json({
        status: "local-processing",
        type: "audio",
        service: "youtube",
        tunnel: [
          "https://cobalt.test/tunnel?id=123456789012345678901&exp=1234567890123&sig=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&sec=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&iv=cccccccccccccccccccccc",
        ],
        output: {
          type: "audio/mpeg",
          filename: "download.mp3",
          metadata: { title: "Download", date: "release-date-that-must-be-replaced" },
        },
        audio: {
          copy: false,
          format: "mp3",
          bitrate: "128",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(makeEvent(makeAudioRequest(undefined, null)));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      output: {
        metadata: {
          title: "Download",
          date: "1987",
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("appends Cobalt machine ids to proxied tunnel URLs", async () => {
    const audioTunnel =
      "https://cobalt.test/tunnel?id=123456789012345678901&exp=1234567890123&sig=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&sec=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&iv=cccccccccccccccccccccc";
    const coverTunnel =
      "https://cobalt.test/tunnel?id=223456789012345678901&exp=1234567890123&sig=ddddddddddddddddddddddddddddddddddddddddddd&sec=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee&iv=ffffffffffffffffffffff";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return Response.json(
          {
            status: "local-processing",
            type: "audio",
            service: "youtube",
            tunnel: [audioTunnel, coverTunnel],
            output: {
              type: "audio/mpeg",
              filename: "download.mp3",
            },
            audio: {
              copy: false,
              format: "mp3",
              bitrate: "128",
            },
          },
          {
            headers: {
              "X-Cobalt-Machine-Id": "cobalt-machine-1",
            },
          },
        );
      }),
    );

    const response = await handler(makeEvent(makeAudioRequest()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "local-processing",
      tunnel: [
        `/api/cobalt/tunnel?url=${encodeURIComponent(audioTunnel)}&machine=cobalt-machine-1&signature=2302919c93e4a4b8486de4ab75fff6f2030499d2c6e85b65a3195de735782113`,
        `/api/cobalt/tunnel?url=${encodeURIComponent(coverTunnel)}&machine=cobalt-machine-1&signature=93217531746bfde711a0169d7ecc2f1598eb8cf2b43521bad3e476194706a1b7`,
      ],
    });
  });

  it("rejects malformed Cobalt machine ids at ingestion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return Response.json(
          {
            status: "tunnel",
            url: "https://cobalt.test/tunnel?id=123456789012345678901",
            filename: "download.mp3",
          },
          {
            headers: {
              "X-Cobalt-Machine-Id": "bad machine",
            },
          },
        );
      }),
    );

    const response = await handler(makeEvent(makeAudioRequest()));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Cobalt returned invalid machine id.");
  });

  it("rejects blank Cobalt machine ids at ingestion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return Response.json(
          {
            status: "tunnel",
            url: "https://cobalt.test/tunnel?id=123456789012345678901",
            filename: "download.mp3",
          },
          {
            headers: {
              "X-Cobalt-Machine-Id": "",
            },
          },
        );
      }),
    );

    const response = await handler(makeEvent(makeAudioRequest()));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Cobalt returned invalid machine id.");
  });

  it("does not retry non-HLS Cobalt errors", async () => {
    const fetchMock = vi.fn(async () => {
      return Response.json({
        status: "error",
        error: {
          code: "error.api.fetch.fail",
        },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(makeEvent(makeAudioRequest()));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("error.api.fetch.fail");
  });

  it("propagates client cancellation to the upstream Cobalt request", async () => {
    const clientAbort = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    let releaseUpstream!: () => void;
    const upstreamReleased = new Promise<void>((resolve) => {
      releaseUpstream = resolve;
    });
    let upstreamStarted!: () => void;
    const upstreamStart = new Promise<void>((resolve) => {
      upstreamStarted = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        upstreamSignal = init?.signal ?? undefined;
        upstreamStarted();
        await upstreamReleased;
        return Response.json({
          status: "error",
          error: { code: "error.api.fetch.fail" },
        });
      }),
    );

    const responsePromise = handler(makeEvent(makeAudioRequest(clientAbort.signal)));
    await upstreamStart;
    clientAbort.abort(new DOMException("canceled", "AbortError"));
    await Promise.resolve();

    try {
      expect(upstreamSignal?.aborted).toBe(true);
    } finally {
      releaseUpstream();
      await responsePromise;
    }
  });

  it("rejects the twenty-first session plan before calling Cobalt", async () => {
    const sessionLimiter = createRateLimitBinding(20);
    const clientLimiter = createRateLimitBinding(60);
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "tunnel",
        url: "https://cobalt.test/tunnel?id=123456789012345678901",
        filename: "download.mp3",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const responses: Response[] = [];
    for (let index = 0; index < 21; index += 1) {
      const request = makeAudioRequest();
      request.headers.set("Cookie", "tagium_client_id=session-1");
      request.headers.set("CF-Connecting-IP", "203.0.113.10");
      request.runtime.cloudflare.env.COBALT_SESSION_RATE_LIMITER = sessionLimiter;
      request.runtime.cloudflare.env.COBALT_CLIENT_RATE_LIMITER = clientLimiter;
      responses.push(await handler(makeEvent(request)));
    }

    expect(responses.slice(0, 20).every((response) => response.status === 200)).toBe(true);
    expect(responses[20].status).toBe(429);
    expect(responses[20].headers.get("Retry-After")).toBe("60");
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it("limits rotating sessions with the coarse client backstop", async () => {
    const sessionLimiter = createRateLimitBinding(20);
    const clientLimiter = createRateLimitBinding(60);
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "tunnel",
        url: "https://cobalt.test/tunnel?id=123456789012345678901",
        filename: "download.mp3",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    let lastResponse: Response | undefined;
    for (let index = 0; index < 61; index += 1) {
      const request = makeAudioRequest();
      request.headers.set("Cookie", `tagium_client_id=session-${index}`);
      request.headers.set("CF-Connecting-IP", "203.0.113.10");
      request.runtime.cloudflare.env.COBALT_SESSION_RATE_LIMITER = sessionLimiter;
      request.runtime.cloudflare.env.COBALT_CLIENT_RATE_LIMITER = clientLimiter;
      lastResponse = await handler(makeEvent(request));
    }

    expect(lastResponse?.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(60);
  });

  it("fails closed when production admission bindings are missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = makeAudioRequest();
    request.runtime.cloudflare.env.TAGIUM_DEPLOY_ENV = "production";

    const response = await handler(makeEvent(request));

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sets an anonymous admission cookie on the first admitted request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "tunnel",
          url: "https://cobalt.test/tunnel?id=123456789012345678901",
          filename: "download.mp3",
        }),
      ),
    );
    const request = makeAudioRequest();
    request.runtime.cloudflare.env.COBALT_SESSION_RATE_LIMITER = createRateLimitBinding(20);
    request.runtime.cloudflare.env.COBALT_CLIENT_RATE_LIMITER = createRateLimitBinding(60);

    const response = await handler(makeEvent(request));

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toMatch(
      /^tagium_client_id=[\w-]+; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/,
    );
  });

  it("preserves Cobalt capacity overload responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return Response.json(
          {
            status: "error",
            error: {
              code: "error.api.capacity_exceeded",
            },
          },
          {
            status: 503,
            headers: {
              "Retry-After": "2",
            },
          },
        );
      }),
    );

    const response = await handler(makeEvent(makeAudioRequest()));

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(await response.json()).toEqual({
      status: "error",
      error: {
        code: "error.api.capacity_exceeded",
      },
    });
  });
});
