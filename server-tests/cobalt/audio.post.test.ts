import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import handler from "../../server/api/cobalt/audio.post";

type RuntimeRequest = Request & {
  runtime: {
    cloudflare: {
      env: {
        COBALT_API_URL: string;
        COBALT_MACHINE_AFFINITY_SECRET: string;
      };
    };
  };
};

const machineAffinitySecret = "test-machine-affinity-secret";

const makeAudioRequest = () => {
  const request = new Request("https://tagium.test/api/cobalt/audio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://tagium.test",
    },
    body: JSON.stringify({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      audioBitrate: "128",
    }),
  }) as RuntimeRequest;

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

const makeEvent = (request: RuntimeRequest) => {
  return { req: request } as unknown as Parameters<typeof handler>[0];
};

describe("cobalt audio endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
        },
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
      },
    });
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
