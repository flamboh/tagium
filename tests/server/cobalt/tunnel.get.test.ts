import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { mockEvent } from "h3";
import handler from "../../../server/api/cobalt/tunnel.get";
import { signCobaltResource } from "../../../server/utils/cobalt-machine-affinity";
import { setDevFault } from "../../../server/utils/dev-controls";

type RuntimeRequest = Request & {
  runtime: {
    cloudflare: {
      env: {
        COBALT_API_URL: string;
        COBALT_MACHINE_AFFINITY_SECRET: string;
        TAGIUM_DEPLOY_ENV?: string;
      };
    };
  };
};

const machineAffinitySecret = "test-machine-affinity-secret";
const tunnelUrl =
  "https://cobalt.test/tunnel?id=123456789012345678901&exp=1234567890123&sig=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&sec=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&iv=cccccccccccccccccccccc";
const tunnelSignature = "2302919c93e4a4b8486de4ab75fff6f2030499d2c6e85b65a3195de735782113";

const makeTunnelRequest = () => {
  const request = new Request(
    `https://tagium.test/api/cobalt/tunnel?url=${encodeURIComponent(tunnelUrl)}`,
  ) as RuntimeRequest;

  request.runtime = {
    cloudflare: {
      env: {
        COBALT_API_URL: "https://cobalt.test/",
        COBALT_MACHINE_AFFINITY_SECRET: machineAffinitySecret,
      },
    },
  };

  return request;
};

const makeTunnelRequestForMachine = () => {
  const request = makeTunnelRequest();
  const url = new URL(request.url);
  url.searchParams.set("machine", "cobalt-machine-1");
  url.searchParams.set("signature", tunnelSignature);
  const machineRequest = new Request(url, request) as RuntimeRequest;
  machineRequest.runtime = request.runtime;

  return machineRequest;
};

const makeTunnelRequestWithId = (id: string) => {
  const request = makeTunnelRequest();
  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL(requestUrl.searchParams.get("url") ?? "");
  upstreamUrl.searchParams.set("id", id);
  requestUrl.searchParams.set("url", upstreamUrl.href);
  const updatedRequest = new Request(requestUrl, request) as RuntimeRequest;
  updatedRequest.runtime = request.runtime;

  return updatedRequest;
};

const makeVideoTunnelRequest = () => {
  const request = makeTunnelRequest();
  const url = new URL(request.url);
  url.searchParams.set("kind", "video");
  const videoRequest = new Request(url, request) as RuntimeRequest;
  videoRequest.runtime = request.runtime;
  return videoRequest;
};

const makeDirectResourceRequest = (
  resourceUrl = "https://cdn.example.test/video.mp4",
  expiresAt = Math.floor(Date.now() / 1_000) + 15 * 60,
) => {
  const request = makeTunnelRequest();
  const url = new URL(request.url);
  url.searchParams.set("url", resourceUrl);
  url.searchParams.set("kind", "video");
  url.searchParams.set("resource", "direct");
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set(
    "signature",
    signCobaltResource(request.runtime.cloudflare.env, resourceUrl, expiresAt),
  );
  const resourceRequest = new Request(url, request) as RuntimeRequest;
  resourceRequest.runtime = request.runtime;
  return resourceRequest;
};

const withObservability = (request: RuntimeRequest) => {
  const url = new URL(request.url);
  url.searchParams.set("parentRequestId", "plan-request-1");
  url.searchParams.set("importId", "import-1");
  url.searchParams.set("sourceFingerprint", `sha256:${"a".repeat(32)}`);
  url.searchParams.set("trackIndex", "7");
  const correlatedRequest = new Request(url, request) as RuntimeRequest;
  correlatedRequest.runtime = request.runtime;
  return correlatedRequest;
};

const makeEvent = (request: RuntimeRequest) => {
  return mockEvent(request);
};

describe("cobalt tunnel endpoint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setDevFault({ target: "tunnel", fault: null });
  });

  it("streams successful tunnel bodies even when upstream reports content-length zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("audio-bytes", {
          headers: {
            "Content-Length": "0",
            "Content-Type": "audio/mpeg",
          },
        });
      }),
    );

    const response = await handler(makeEvent(makeTunnelRequest()));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("X-Tagium-Tunnel-Outcome")).toBe("ready");
    expect(response.headers.get("X-Tagium-Tunnel-Attempts")).toBe("1");
    expect(await response.text()).toBe("audio-bytes");
  });

  it("forwards a positive upstream length as a download progress estimate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("video-bytes", {
          headers: {
            "Content-Length": "11",
            "Content-Type": "video/mp4",
          },
        });
      }),
    );

    const response = await handler(makeEvent(makeTunnelRequest()));

    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.headers.get("Estimated-Content-Length")).toBe("11");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("video-bytes");
  });

  it("streams marked video tunnels without an absolute timeout", async () => {
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(new AbortController().signal);
    const request = makeVideoTunnelRequest();
    let upstreamSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        upstreamSignal = init?.signal;
        return new Response("video-bytes");
      }),
    );

    const response = await handler(makeEvent(request));

    expect(response.status).toBe(200);
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(upstreamSignal).toBe(request.signal);
  });

  it("keeps the bounded timeout for audio tunnels", async () => {
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(new AbortController().signal);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("audio-bytes")),
    );

    const response = await handler(makeEvent(makeTunnelRequest()));

    expect(response.status).toBe(200);
    expect(timeoutSpy).toHaveBeenCalledWith(5 * 60_000);
  });

  it("streams marked video tunnels without a separate admission binding", async () => {
    const request = makeVideoTunnelRequest();
    request.runtime.cloudflare.env.TAGIUM_DEPLOY_ENV = "preview";
    const fetchMock = vi.fn(async () => new Response("video-bytes"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(makeEvent(request));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("video-bytes");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("never follows an upstream tunnel redirect", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 302, headers: { Location: "https://example.test/private" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(makeEvent(makeTunnelRequest()));
    const [, init] = fetchMock.mock.calls[0] ?? [];

    expect(response.status).toBe(502);
    expect(init?.redirect).toBe("manual");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("streams signed direct picker resources and follows their CDN redirects", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response("video-bytes", { headers: { "Content-Type": "video/mp4" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(makeEvent(makeDirectResourceRequest()));
    const [, init] = fetchMock.mock.calls[0] ?? [];

    expect(response.status).toBe(200);
    expect(init?.redirect).toBe("follow");
    expect(await response.text()).toBe("video-bytes");
  });

  it("rejects tampered direct picker resource URLs", async () => {
    const request = makeDirectResourceRequest();
    const url = new URL(request.url);
    url.searchParams.set("url", "https://cdn.example.test/private.mp4");
    const tamperedRequest = new Request(url, request) as RuntimeRequest;
    tamperedRequest.runtime = request.runtime;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(makeEvent(tamperedRequest));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects expired direct picker resource capabilities", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(
      makeEvent(makeDirectResourceRequest(undefined, Math.floor(Date.now() / 1_000) - 1)),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a bounded empty 200 tunnel response", async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt++;
      return attempt < 4 ? new Response(null, { status: 200 }) : new Response("audio-bytes");
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await handler(makeEvent(makeTunnelRequest()));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Tagium-Tunnel-Outcome")).toBe("recovered");
    expect(response.headers.get("X-Tagium-Tunnel-Attempts")).toBe("4");
    expect(await response.text()).toBe("audio-bytes");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("recovers when a tunnel becomes ready after the original retry window", async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt++;
      return attempt < 7 ? new Response(null, { status: 200 }) : new Response("audio-bytes");
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const responsePromise = handler(makeEvent(makeTunnelRequest()));
      await vi.advanceTimersByTimeAsync(10_000);
      const response = await responsePromise;

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Tagium-Tunnel-Outcome")).toBe("recovered");
      expect(response.headers.get("X-Tagium-Tunnel-Attempts")).toBe("7");
      expect(await response.text()).toBe("audio-bytes");
      expect(fetchMock).toHaveBeenCalledTimes(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deterministically staggers retries for different tunnel urls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const attemptsByUrl = new Map<string, number>();
    const startTimesByUrl = new Map<string, number[]>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : input.toString();
        const attempts = (attemptsByUrl.get(url) ?? 0) + 1;
        attemptsByUrl.set(url, attempts);
        startTimesByUrl.set(url, [...(startTimesByUrl.get(url) ?? []), Date.now()]);
        return attempts === 1 ? new Response(null, { status: 200 }) : new Response("audio-bytes");
      }),
    );

    try {
      const first = handler(makeEvent(makeTunnelRequestWithId("tunnel-a")));
      const second = handler(makeEvent(makeTunnelRequestWithId("tunnel-b")));
      await vi.advanceTimersByTimeAsync(200);
      await Promise.all([first, second]);

      const retryDelays = [...startTimesByUrl.values()].map(
        ([startedAt = 0, retriedAt = 0]) => retriedAt - startedAt,
      );
      expect(retryDelays).toHaveLength(2);
      expect(retryDelays.every((delay) => delay >= 80 && delay <= 120)).toBe(true);
      expect(new Set(retryDelays).size).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops after the bounded extended retry window", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const responsePromise = handler(makeEvent(makeTunnelRequest()));
      await vi.advanceTimersByTimeAsync(10_000);
      const response = await responsePromise;

      expect(response.status).toBe(502);
      expect(response.headers.get("X-Tagium-Tunnel-Outcome")).toBe("exhausted");
      expect(response.headers.get("X-Tagium-Tunnel-Attempts")).toBe("7");
      expect(fetchMock).toHaveBeenCalledTimes(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying when the shared tunnel timeout aborts a backoff", async () => {
    vi.useFakeTimers();
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const responsePromise = handler(makeEvent(makeTunnelRequest()));
      await vi.advanceTimersByTimeAsync(0);
      timeout.abort(new DOMException("timed out", "TimeoutError"));
      const response = await responsePromise;

      expect(response.status).toBe(502);
      expect(response.headers.get("X-Tagium-Tunnel-Outcome")).toBe("non_retryable");
      expect(response.headers.get("X-Tagium-Tunnel-Attempts")).toBe("1");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying when the downstream tunnel request is aborted", async () => {
    vi.useFakeTimers();
    const downstream = new AbortController();
    const request = makeTunnelRequest();
    const abortableRequest = new Request(request, { signal: downstream.signal }) as RuntimeRequest;
    abortableRequest.runtime = request.runtime;
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const responsePromise = handler(makeEvent(abortableRequest));
      await vi.advanceTimersByTimeAsync(0);
      downstream.abort(new DOMException("cancelled", "AbortError"));
      const result = await Promise.race([
        responsePromise,
        vi.advanceTimersByTimeAsync(1).then(() => "pending" as const),
      ]);

      expect(result).not.toBe("pending");
      if (result === "pending") return;
      expect(result.status).toBe(502);
      expect(result.headers.get("X-Tagium-Tunnel-Outcome")).toBe("non_retryable");
      expect(result.headers.get("X-Tagium-Tunnel-Attempts")).toBe("1");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry non-ok responses", async () => {
    const fetchMock = vi.fn(async () => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await handler(makeEvent(makeTunnelRequest()));
    expect(response.status).toBe(502);
    expect(response.headers.get("X-Tagium-Tunnel-Outcome")).toBe("non_retryable");
    expect(response.headers.get("X-Tagium-Tunnel-Attempts")).toBe("1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels an upstream stream when a later read fails", async () => {
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++;
        if (reads === 1) controller.enqueue(new TextEncoder().encode("first"));
        else controller.error(new Error("upstream read failed"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream)),
    );
    const response = await handler(makeEvent(makeTunnelRequest()));
    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow();
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  it("forwards Fly machine affinity when machine param is present", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      return new Response("audio-bytes", {
        headers: {
          "Content-Type": "audio/mpeg",
        },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(makeEvent(withObservability(makeTunnelRequestForMachine())));
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);

    expect(response.status).toBe(200);
    expect(headers.get("Fly-Force-Instance-Id")).toBe("cobalt-machine-1");
    expect(headers.get("X-Tagium-Tunnel-Request-Id")).toMatch(/^tagium-tunnel-/);
    expect(headers.get("X-Tagium-Parent-Request-Id")).toBe("plan-request-1");
    expect(headers.get("X-Tagium-Import-Id")).toBe("import-1");
    expect(headers.get("X-Tagium-Source-Fingerprint")).toBe(`sha256:${"a".repeat(32)}`);
    expect(headers.get("X-Tagium-Track-Index")).toBe("7");
  });

  it("logs upstream tunnel failures with machine affinity context", async () => {
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("missing tunnel", { status: 404 });
      }),
    );

    const response = await handler(makeEvent(makeTunnelRequestForMachine()));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Cobalt tunnel request failed (404).");
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warnMock.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
      event: "cobalt_tunnel_failure",
      message: "upstream non-ok",
      machineId: "cobalt-machine-1",
      tunnelId: "123456789012345678901",
      status: 404,
      responseBytes: 14,
    });
  });

  it("preserves Cobalt tunnel capacity overload responses", async () => {
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
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

    const response = await handler(makeEvent(makeTunnelRequestForMachine()));

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(response.headers.get("X-Tagium-Tunnel-Outcome")).toBe("non_retryable");
    expect(response.headers.get("X-Tagium-Tunnel-Attempts")).toBe("1");
    expect(await response.json()).toEqual({
      status: "error",
      error: {
        code: "error.api.capacity_exceeded",
      },
    });
    expect(JSON.parse(warnMock.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
      event: "cobalt_tunnel_failure",
      message: "upstream capacity exceeded",
      machineId: "cobalt-machine-1",
      tunnelId: "123456789012345678901",
      status: 503,
      retryAfter: "2",
    });
  });

  it("rejects tampered tunnel machine affinity", async () => {
    const request = makeTunnelRequestForMachine();
    const url = new URL(request.url);
    url.searchParams.set("machine", "cobalt-machine-2");
    const tamperedRequest = new Request(url, request) as RuntimeRequest;
    tamperedRequest.runtime = request.runtime;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(makeEvent(tamperedRequest));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid Cobalt tunnel URL.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects tampered tunnel machine signatures", async () => {
    const request = makeTunnelRequestForMachine();
    const url = new URL(request.url);
    url.searchParams.set("signature", "a".repeat(64));
    const tamperedRequest = new Request(url, request) as RuntimeRequest;
    tamperedRequest.runtime = request.runtime;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(makeEvent(tamperedRequest));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid Cobalt tunnel URL.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty successful Cobalt tunnel responses", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(null, {
          headers: {
            "Content-Type": "audio/mpeg",
          },
        });
      }),
    );

    try {
      const responsePromise = handler(makeEvent(makeTunnelRequest()));
      await vi.advanceTimersByTimeAsync(10_000);
      const response = await responsePromise;

      expect(response.status).toBe(502);
      expect(await response.text()).toBe("Cobalt tunnel response was empty.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a safe compatibility response when the upstream fetch throws", async () => {
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("private upstream detail");
      }),
    );

    const response = await handler(makeEvent(makeTunnelRequest()));

    expect(response.status).toBe(502);
    expect(response.headers.get("X-Tagium-Tunnel-Outcome")).toBe("non_retryable");
    expect(response.headers.get("X-Tagium-Tunnel-Attempts")).toBe("1");
    expect(await response.text()).toBe("private upstream detail");
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain("private upstream detail");
  });

  it("reports the number of attempts begun before a retry fetch throws", async () => {
    let attempts = 0;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) return new Response(null, { status: 200 });
        throw new TypeError("second fetch failed");
      }),
    );

    const response = await handler(makeEvent(makeTunnelRequest()));

    expect(response.status).toBe(502);
    expect(response.headers.get("X-Tagium-Tunnel-Outcome")).toBe("non_retryable");
    expect(response.headers.get("X-Tagium-Tunnel-Attempts")).toBe("2");
    expect(await response.text()).toBe("second fetch failed");
  });

  it("preserves the established timeout wording for aborted upstream fetches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    );

    const response = await handler(makeEvent(makeTunnelRequest()));

    expect(response.status).toBe(502);
    expect(response.headers.get("X-Tagium-Tunnel-Outcome")).toBe("non_retryable");
    expect(response.headers.get("X-Tagium-Tunnel-Attempts")).toBe("1");
    expect(await response.text()).toBe("Cobalt tunnel request timed out.");
  });

  it("annotates a pre-fetch dev timeout with one synthetic attempt", async () => {
    const request = makeTunnelRequest();
    request.runtime.cloudflare.env.TAGIUM_DEPLOY_ENV = "local";
    setDevFault({ target: "tunnel", fault: "timeout" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(makeEvent(request));

    expect(response.status).toBe(502);
    expect(response.headers.get("X-Tagium-Tunnel-Outcome")).toBe("non_retryable");
    expect(response.headers.get("X-Tagium-Tunnel-Attempts")).toBe("1");
    expect(await response.text()).toBe("Cobalt tunnel request timed out.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
