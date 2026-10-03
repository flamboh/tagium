import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { HTTPError } from "nitro";
import { mockEvent } from "h3";
import { Schema } from "effect";
import handler from "../../../server/api/cobalt/audio.post";

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
const cobaltRequestSchema = Schema.Struct({
  audioFormat: Schema.String,
  youtubeVideoCodec: Schema.String,
  youtubeHLS: Schema.Boolean,
});

const makeAudioRequest = (
  signal?: AbortSignal,
  year: number | null = 2020,
  options: {
    sourceUrl?: string;
    audioFormat?: "best" | "mp3";
  } = {},
) => {
  const request = new Request("https://tagium.test/api/cobalt/audio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://tagium.test",
      "X-Tagium-Request-Id": "request-test",
    },
    body: JSON.stringify(
      Object.assign(
        {
          url: options.sourceUrl ?? "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          audioBitrate: "128",
          audioFormat: options.audioFormat ?? "mp3",
        },
        year === null ? undefined : { year },
      ),
    ),
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
  return mockEvent(request);
};

describe("cobalt audio endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps invalid request bodies to HTTP 400 errors", async () => {
    const request = makeAudioRequest();
    const invalidRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        url: "not a URL",
        audioBitrate: "lossless",
        audioFormat: "flac",
        year: 99,
      }),
    }) as RuntimeRequest;
    invalidRequest.runtime = request.runtime;

    const error = await handler(makeEvent(invalidRequest)).catch((cause) => cause);

    expect(HTTPError.isError(error)).toBe(true);
    expect(error).toMatchObject({ status: 400 });
    expect(error.message).toContain('["url"]');
  });

  it.each([
    {
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      expectedFormat: "best",
    },
    {
      sourceUrl: "https://soundcloud.com/artist/track",
      expectedFormat: "best",
    },
    {
      sourceUrl: "https://m.soundcloud.com/artist/track",
      expectedFormat: "best",
    },
    {
      sourceUrl: "https://soundcloud.com.example/artist/track",
      expectedFormat: "mp3",
    },
  ])("applies the compatible best format policy for $sourceUrl", async (testCase) => {
    let cobaltBody: Schema.Schema.Type<typeof cobaltRequestSchema> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const serializedBody = Schema.decodeUnknownSync(Schema.String)(init?.body);
        cobaltBody = Schema.decodeUnknownSync(cobaltRequestSchema)(JSON.parse(serializedBody));
        return Response.json({
          status: "tunnel",
          url: "https://cobalt.test/tunnel?id=123456789012345678901",
          filename: "download.m4a",
        });
      }),
    );

    const response = await handler(
      makeEvent(
        makeAudioRequest(undefined, 2020, {
          sourceUrl: testCase.sourceUrl,
          audioFormat: "best",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(cobaltBody).toEqual({
      audioFormat: testCase.expectedFormat,
      youtubeVideoCodec: "h264",
      youtubeHLS: false,
    });
  });

  it("classifies malformed upstream payloads as gateway failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sentinel = "https://soundcloud.com/private/s-secret-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ status: "a-future-cobalt-status", echoed: sentinel })),
    );

    const response = await handler(makeEvent(makeAudioRequest()));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("error.api.invalid_response");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(sentinel);
  });

  it("correlates and logs structured Cobalt failures without the source URL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let upstreamHeaders = new Headers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        upstreamHeaders = new Headers(init?.headers);
        return Response.json(
          {
            status: "error",
            error: {
              code: "error.api.fetch.fail",
              context: { service: "soundcloud" },
            },
          },
          {
            status: 400,
            headers: { "X-Cobalt-Machine-Id": "cobalt-machine-1" },
          },
        );
      }),
    );
    const request = makeAudioRequest();
    request.headers.set("X-Tagium-Request-Id", "request-1");
    request.headers.set("X-Tagium-Import-Id", "import-1");
    request.headers.set("X-Tagium-Track-Index", "7");

    const response = await handler(makeEvent(request));

    expect(response.status).toBe(502);
    expect(response.headers.get("X-Tagium-Request-Id")).toBe("request-1");
    expect(upstreamHeaders.get("X-Tagium-Request-Id")).toBe("request-1");
    expect(upstreamHeaders.get("X-Tagium-Import-Id")).toBe("import-1");
    expect(upstreamHeaders.get("X-Tagium-Track-Index")).toBe("7");
    expect(upstreamHeaders.get("X-Tagium-Source-Fingerprint")).toMatch(/^sha256:[a-f0-9]{32}$/);
    const event = warn.mock.calls
      .map(([entry]) => JSON.parse(entry))
      .find((entry) => entry.event === "cobalt_audio_failure");
    expect(event).toMatchObject({
      requestId: "request-1",
      importId: "import-1",
      trackIndex: 7,
      stage: "cobalt.resolve_error",
      upstreamStatus: 400,
      errorCode: "error.api.fetch.fail",
      machineId: "cobalt-machine-1",
    });
    expect(JSON.stringify(event)).not.toContain("youtube.com");
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
});
