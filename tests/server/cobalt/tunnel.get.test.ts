import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { mockEvent } from "h3";
import handler from "../../../server/api/cobalt/tunnel.get";
import { signCobaltResource } from "../../../server/utils/cobalt-machine-affinity";

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

const makeEvent = (request: RuntimeRequest) => {
  return mockEvent(request);
};

describe("cobalt tunnel endpoint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it("rejects expired direct picker resource capabilities", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(
      makeEvent(makeDirectResourceRequest(undefined, Math.floor(Date.now() / 1_000) - 1)),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
