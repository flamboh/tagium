import { FAKE_COBALT_API_KEY, FAKE_COBALT_MACHINE_ID } from "../harness/protocol.ts";
import { expect, test } from "../support/test";

const DOWNLOAD = "/api/cobalt/download";

test("the download api only answers requests from its own origin", async ({
  request,
  upstreams,
}) => {
  const video = await upstreams.youtube.video();

  const missing = await request.post(DOWNLOAD, { data: { url: video.url } });
  expect(missing.status()).toBe(403);
  expect(await missing.text()).toBe("Download requests require an Origin header.");

  const foreign = await request.post(DOWNLOAD, {
    data: { url: video.url },
    headers: { Origin: "https://evil.example.test" },
  });
  expect(foreign.status()).toBe(403);
  expect(await foreign.text()).toBe("Download origin is not allowed.");
  expect(await upstreams.calls({ route: "cobalt.resolve" })).toHaveLength(0);
});

test("the download api rejects invalid requests before contacting cobalt", async ({
  request,
  baseURL,
  upstreams,
}) => {
  const video = await upstreams.youtube.video();
  const headers = { Origin: new URL(baseURL!).origin };

  for (const data of [
    { url: "not a url", downloadMode: "everything" },
    { url: "ftp://example.com/a" },
    { url: video.url, videoQuality: "2160" },
  ]) {
    const response = await request.post(DOWNLOAD, { data, headers });
    expect(response.status(), JSON.stringify(data)).toBe(400);
  }
  expect(await upstreams.calls({ route: "cobalt.resolve" })).toHaveLength(0);
});

test("the download api forces proxied local processing and signs its tunnels", async ({
  request,
  baseURL,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({ cover: null });
  const origin = new URL(baseURL!).origin;

  const response = await request.post(DOWNLOAD, {
    headers: {
      Origin: origin,
      "X-Tagium-Request-Id": "api-request-1",
      "X-Tagium-Import-Id": "import-1",
      "X-Tagium-Track-Index": "7",
    },
    data: {
      url: video.url,
      downloadMode: "mute",
      videoQuality: "720",
      youtubeVideoCodec: "h264",
      youtubeVideoContainer: "mp4",
      audioFormat: "opus",
      audioBitrate: "8",
      filenameStyle: "pretty",
      youtubeHLS: true,
      alwaysProxy: false,
      localProcessing: "disabled",
      ignoredOption: "must not reach cobalt",
    },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["x-tagium-request-id"]).toBe("api-request-1");
  expect(response.headers().authorization).toBeUndefined();

  const [resolve] = await upstreams.calls({ route: "cobalt.resolve" });
  const upstreamBody = JSON.parse(resolve!.requestBody!);
  expect(upstreamBody).toMatchObject({
    url: video.url,
    downloadMode: "mute",
    videoQuality: "720",
    audioFormat: "opus",
    audioBitrate: "8",
    alwaysProxy: true,
    localProcessing: "forced",
    youtubeHLS: false,
  });
  expect(upstreamBody).not.toHaveProperty("ignoredOption");
  expect(resolve!.requestHeaders).toMatchObject({
    authorization: `Api-Key ${FAKE_COBALT_API_KEY}`,
    "x-tagium-request-id": "api-request-1",
    "x-tagium-import-id": "import-1",
    "x-tagium-track-index": "7",
    "x-tagium-source-fingerprint": expect.stringMatching(/^sha256:[a-f0-9]{32}$/u),
  });

  const plan = await response.json();
  const tunnel = new URL(plan.tunnel[0], origin);
  expect(tunnel.pathname).toBe("/api/cobalt/tunnel");
  expect(Object.fromEntries(tunnel.searchParams)).toMatchObject({
    kind: "video",
    machine: FAKE_COBALT_MACHINE_ID,
    signature: expect.stringMatching(/^[a-f0-9]{64}$/u),
    parentRequestId: "api-request-1",
    importId: "import-1",
    trackIndex: "7",
  });

  const media = await request.get(`${tunnel.pathname}${tunnel.search}`, { maxRetries: 2 });
  expect(media.status()).toBe(200);
  expect(media.headers()).toMatchObject({
    "content-type": "video/mp4",
    "cache-control": "private, no-store",
    "x-tagium-tunnel-outcome": "ready",
    "x-tagium-tunnel-attempts": "1",
  });
  expect((await media.body()).byteLength).toBeGreaterThan(0);
  const [fetched] = await upstreams.calls({ route: "cobalt.tunnel.video" });
  expect(fetched!.requestHeaders).toMatchObject({
    "fly-force-instance-id": FAKE_COBALT_MACHINE_ID,
    "x-tagium-parent-request-id": "api-request-1",
  });

  const tampered = (change: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(tunnel.searchParams);
    change(params);
    return request.get(`${tunnel.pathname}?${params}`);
  };
  for (const change of [
    (params: URLSearchParams) => params.set("signature", "0".repeat(64)),
    (params: URLSearchParams) => params.set("machine", "e2e-machine-2"),
    (params: URLSearchParams) => params.set("kind", "audio"),
    (params: URLSearchParams) => params.set("url", "https://example.com/tunnel?id=1"),
    (params: URLSearchParams) => params.set("url", plan.tunnel[0].replace("/tunnel", "/private")),
  ]) {
    const rejected = await tampered(change);
    expect(rejected.status()).toBe(400);
    expect(await rejected.text()).toBe("Invalid Cobalt tunnel URL.");
  }
  expect(await upstreams.calls({ route: "cobalt.tunnel.video" })).toHaveLength(1);
});

test("the download api signs direct post media for a limited time", async ({
  request,
  baseURL,
  upstreams,
}) => {
  const post = await upstreams.picker({
    items: [{ type: "photo", asset: "cover", directFilename: "photo.jpg" }],
  });
  const origin = new URL(baseURL!).origin;

  const response = await request.post(DOWNLOAD, {
    headers: { Origin: origin },
    data: { url: post.url },
  });
  const plan = await response.json();
  const resource = new URL(plan.picker[0].url, origin);
  expect(resource.pathname).toBe("/api/cobalt/tunnel");
  expect(Object.fromEntries(resource.searchParams)).toMatchObject({
    resource: "direct",
    kind: "video",
    expires: expect.stringMatching(/^\d{10}$/u),
    signature: expect.stringMatching(/^[a-f0-9]{64}$/u),
  });
  const expires = Number(resource.searchParams.get("expires"));
  expect(expires * 1000 - Date.now()).toBeGreaterThan(10 * 60_000);
  expect(expires * 1000 - Date.now()).toBeLessThanOrEqual(15 * 60_000);

  const photo = await request.get(`${resource.pathname}${resource.search}`, { maxRetries: 2 });
  expect(photo.status()).toBe(200);

  for (const [name, value] of [
    ["url", "https://cdn.e2e.test/other/photo.jpg"],
    ["expires", String(expires + 60)],
    ["signature", "0".repeat(64)],
  ] as const) {
    const params = new URLSearchParams(resource.searchParams);
    params.set(name, value);
    const rejected = await request.get(`${resource.pathname}?${params}`);
    expect(rejected.status(), name).toBe(400);
  }
  expect(await upstreams.calls({ route: "media.direct" })).toHaveLength(1);
});

test("the download api passes redirects through and refuses unsafe ones", async ({
  request,
  baseURL,
  upstreams,
}) => {
  const video = await upstreams.youtube.video();
  const redirect = {
    status: "redirect",
    url: "https://cdn.example.test/video.mp4",
    filename: "video.mp4",
  };
  await upstreams.cobalt.respond(video.url, [
    { kind: "json", body: redirect },
    { kind: "json", body: { ...redirect, url: "javascript:alert(1)" } },
  ]);
  const headers = { Origin: new URL(baseURL!).origin };

  const safe = await request.post(DOWNLOAD, { headers, data: { url: video.url } });
  expect(safe.status()).toBe(200);
  expect(await safe.json()).toEqual(redirect);

  const unsafe = await request.post(DOWNLOAD, { headers, data: { url: video.url } });
  expect(unsafe.status()).toBe(502);
  expect(await unsafe.json()).toEqual({
    status: "error",
    error: { code: "error.api.invalid_response" },
  });
});
