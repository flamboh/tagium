import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import handler from "../../server/api/cobalt/audio.post";

type RuntimeRequest = Request & {
  runtime: {
    cloudflare: {
      env: {
        COBALT_API_URL: string;
      };
    };
  };
};

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
});
