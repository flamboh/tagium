import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import handler from "../../server/api/cobalt/tunnel.get";

type RuntimeRequest = Request & {
  runtime: {
    cloudflare: {
      env: {
        COBALT_API_URL: string;
      };
    };
  };
};

const makeTunnelRequest = () => {
  const request = new Request(
    "https://tagium.test/api/cobalt/tunnel?url=https%3A%2F%2Fcobalt.test%2Ftunnel%3Fid%3D123456789012345678901%26exp%3D1234567890123%26sig%3Daaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%26sec%3Dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb%26iv%3Dcccccccccccccccccccccc",
  ) as RuntimeRequest;

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

describe("cobalt tunnel endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
    expect(await response.text()).toBe("audio-bytes");
  });

  it("preserves upstream content-length when available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("audio-bytes", {
          headers: {
            "Content-Length": "11",
            "Content-Type": "audio/mpeg",
          },
        });
      }),
    );

    const response = await handler(makeEvent(makeTunnelRequest()));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Content-Length")).toBe("11");
    expect(await response.text()).toBe("audio-bytes");
  });

  it("rejects empty successful Cobalt tunnel responses", async () => {
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

    const response = await handler(makeEvent(makeTunnelRequest()));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Cobalt tunnel response was empty.");
  });
});
