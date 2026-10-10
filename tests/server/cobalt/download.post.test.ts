import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { mockEvent } from "h3";
import handler from "../../../server/api/cobalt/download.post";
import { captureSentryEvents } from "../sentry-events";
import { resetRateLimitBuckets } from "../../../server/utils/dev-controls";

type RequestBodyValue = string | boolean;

type RuntimeEnv = {
  COBALT_API_URL: string;
  COBALT_API_KEY?: string;
  COBALT_MACHINE_AFFINITY_SECRET: string;
  TAGIUM_DEPLOY_ENV: "local" | "preview" | "production";
};

type RuntimeRequest = Request & {
  runtime: { cloudflare: { env: RuntimeEnv } };
};

const machineAffinitySecret = "test-machine-affinity-secret";

const sourceUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

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

describe("cobalt video download endpoint", () => {
  afterEach(() => {
    resetRateLimitBuckets();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports upstream failures with the source service and cobalt code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { status: "error", error: { code: "error.api.content.video.unavailable" } },
          { status: 400, headers: { "X-Cobalt-Machine-Id": "cobalt-machine-1" } },
        ),
      ),
    );

    let response: Response | undefined;

    const events = await captureSentryEvents(async () => {
      response = await handler(makeEvent(makeRequest()));
    });

    expect(response?.status).toBe(502);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      message: "youtube download failed: error.api.content.video.unavailable",
      tags: {
        route: "download",
        service: "youtube",
        stage: "cobalt.resolve_error",
        error_code: "error.api.content.video.unavailable",
        upstream_status: 400,
        machine_id: "cobalt-machine-1",
        request_id: "request-test",
      },
    });
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
});
