import { Buffer } from "node:buffer";
import { request as httpRequest } from "node:http";
import type { APIRequestContext } from "@playwright/test";
import { E2E_BASE_URL } from "../harness/protocol.ts";
import { expect, test } from "./fixtures";
import {
  albumManifest,
  coverUpload,
  createShare,
  imageBytes,
  randomIp,
  type CreatedShare,
} from "./helpers";

const noStoreStatus = (response: {
  status: () => number;
  headers: () => Record<string, string>;
}) => ({
  status: response.status(),
  cacheControl: response.headers()["cache-control"],
});

const MAX_PUBLICATION_BYTES = 256 * 1024 + 5 * 1024 * 1024 + 64 * 1024;

const uploadUntilAnswered = (headers: Record<string, string>, body: Uint8Array) =>
  new Promise<number>((resolve, reject) => {
    const outgoing = httpRequest(new URL("/api/manifests", E2E_BASE_URL), {
      method: "POST",
      headers,
    });

    outgoing.on("response", (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
      outgoing.destroy();
    });
    outgoing.on("error", reject);
    outgoing.write(body);
  });

const byText = (left: string | null, right: string | null) =>
  (left ?? "").localeCompare(right ?? "");

const shareSource = (request: APIRequestContext, fields: Record<string, string>) =>
  request.post("/api/shares", { headers: { Accept: "application/json" }, multipart: fields });

test("a playlist url becomes an album share without downloading any audio", async ({
  page,
  request,
  upstreams,
}) => {
  const playlist = await upstreams.youtube.playlist({
    title: "Source Playlist",
    author: "Curator",
    videos: [
      { title: "Alpha: Part 1", author: "Alpha Artist - Topic", year: 2011 },
      { title: "Beta", author: "Beta Artist", year: 2018 },
      { title: "Gamma", author: "Gamma Artist" },
    ],
  });

  const response = await shareSource(request, {
    source: playlist.url,
    album: JSON.stringify({ title: "Renamed Album", artist: "Renamed Artist" }),
  });

  expect(response.status()).toBe(201);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const share = (await response.json()) as CreatedShare;
  expect(share).toEqual({
    slug: expect.stringMatching(/^[23456789abcdefghjkmnpqrstvwxyz]{6}$/u),
    url: new URL(`/share/${share.slug}`, E2E_BASE_URL).href,
    expiresAt: expect.any(String),
    revocationToken: expect.any(String),
    analyticsId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
  });
  expect(Date.parse(share.expiresAt!) - Date.now()).toBeGreaterThan(89 * 24 * 60 * 60 * 1000);
  expect(Date.parse(share.expiresAt!) - Date.now()).toBeLessThanOrEqual(90 * 24 * 60 * 60 * 1000);

  const stored = await (await request.get(`/api/manifests/${share.slug}`)).json();
  expect(Object.keys(stored).sort()).toEqual(["analyticsId", "expiresAt", "manifest"]);
  expect(stored.manifest).toMatchObject({
    version: 1,
    kind: "album",
    album: {
      title: "Renamed Album",
      artist: "Renamed Artist",
      sourceUrl: playlist.url,
      year: 2011,
    },
  });
  expect(stored.manifest.tracks).toEqual(
    [
      { filename: "Alpha- Part 1", title: "Alpha: Part 1", artist: "Alpha Artist", trackNumber: 1 },
      { filename: "Beta", title: "Beta", artist: "Beta Artist", trackNumber: 2 },
      { filename: "Gamma", title: "Gamma", artist: "Gamma Artist", trackNumber: 3 },
    ].map((metadata, index) => ({
      sourceUrl: playlist.videos[index]!.url,
      audioBitrate: "320",
      metadata: { ...metadata, album: "Renamed Album", genre: "" },
    })),
  );
  expect((await upstreams.calls({ route: "youtube.next" })).map((call) => call.key)).toEqual([
    playlist.videos[0]!.key,
  ]);
  expect(await upstreams.calls({ route: /^cobalt\./u })).toEqual([]);

  await page.goto(share.url);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Renamed Album" })).toBeVisible();
  await expect(main.getByText("Renamed Artist", { exact: true })).toBeVisible();
  await expect(main.getByText(/^shared album · 3 tracks · link expires /u)).toBeVisible();
  await expect(main.getByRole("region", { name: "3 tracks" }).getByRole("listitem")).toHaveText([
    /Alpha: Part 1/u,
    /Beta/u,
    /Gamma/u,
  ]);
});

test("a soundcloud set shares indefinitely with its genre, release year and an uploaded cover", async ({
  page,
  request,
  upstreams,
}) => {
  const set = await upstreams.soundcloud.set({
    title: "Deep Set",
    author: "Cloud Artist",
    genre: "Ambient",
    releaseDate: "2016-05-20T00:00:00Z",
    isAlbum: true,
    tracks: [{ title: "One" }, { title: "Two", stub: true }],
  });

  const response = await shareSource(request, { source: set.url, lifetime: "indefinite" });
  const receipt = response;
  expect(receipt.status()).toBe(201);
  const plain = (await receipt.json()) as CreatedShare;
  expect(plain.expiresAt).toBeNull();
  const stored = await (await request.get(`/api/manifests/${plain.slug}`)).json();
  expect(stored.expiresAt).toBeNull();
  expect(stored.manifest.album).toMatchObject({
    title: "Deep Set",
    artist: "Cloud Artist",
    genre: "Ambient",
    year: 2016,
    sourceUrl: set.url,
  });
  expect(stored.manifest.tracks.map((track: { sourceUrl: string }) => track.sourceUrl)).toEqual(
    set.tracks.map((track) => track.url),
  );

  const covered = await request.post("/api/shares", {
    multipart: { source: set.url, lifetime: "indefinite", cover: coverUpload("artwork") },
  });

  expect(covered.status()).toBe(201);
  const coveredShare = (await covered.json()) as CreatedShare;
  expect(
    new Uint8Array(await (await request.get(`/api/manifests/${coveredShare.slug}/artwork`)).body()),
  ).toEqual(imageBytes("artwork"));

  await page.goto(coveredShare.url);
  const main = page.getByRole("main");
  await expect(main.getByText("shared album · 2 tracks", { exact: true })).toBeVisible();
  await expect(
    main.getByRole("link", { name: "from soundcloud.com (opens in a new tab)" }),
  ).toBeVisible();
  await expect(main.getByRole("img", { name: "Deep Set cover" })).toBeVisible();
});

test("playlist shares reject bad sources, overrides, origins and fields", async ({
  request,
  upstreams,
}) => {
  const video = await upstreams.youtube.video();
  const playlist = await upstreams.youtube.playlist({ videos: [{}] });
  const missing = await upstreams.youtube.playlist({ videos: [{}], status: 404 });

  const invalidFields: Record<string, string>[] = [
    { source: video.url },
    { source: "https://example.com/playlist" },
    { source: missing.url },
    { source: playlist.url, album: JSON.stringify({ title: "x", unexpected: true }) },
    { source: playlist.url, lifetime: "forever" },
    { source: playlist.url, extra: "field" },
  ];

  for (const fields of invalidFields) {
    const response = await shareSource(request, fields);
    expect(noStoreStatus(response), JSON.stringify(fields)).toEqual({
      status: 400,
      cacheControl: "no-store",
    });
  }

  const crossSite = await request.post("/api/shares", {
    headers: { Origin: "https://evil.example" },
    multipart: { source: playlist.url },
  });

  expect(crossSite.status()).toBe(400);
  const json = await request.post("/api/shares", { data: { source: playlist.url } });
  expect(json.status()).toBe(400);

  const ip = randomIp();
  await upstreams.rateLimits.limit("SHARE_CREATE_RATE_LIMITER", ip, 0);

  const limited = await request.post("/api/shares", {
    headers: { "cf-connecting-ip": ip },
    multipart: { source: playlist.url },
  });

  expect(noStoreStatus(limited)).toEqual({ status: 429, cacheControl: "no-store" });
  expect(limited.headers()["retry-after"]).toBeUndefined();
  expect(
    (await upstreams.calls({ route: "youtube.playlist" })).map((call) => call.key).toSorted(byText),
  ).toEqual([missing.key]);
});

test("playlist shares reject an album override out of the manifest's range before resolving the playlist", async ({
  request,
  upstreams,
}) => {
  const playlist = await upstreams.youtube.playlist({ videos: [{}] });

  for (const album of [
    { year: 99_999 },
    { year: 999 },
    { year: 2020.5 },
    { title: "x".repeat(1_025) },
    { artist: "x".repeat(1_025) },
    { genre: "x".repeat(1_025) },
  ]) {
    const response = await shareSource(request, {
      source: playlist.url,
      album: JSON.stringify(album),
    });

    expect(noStoreStatus(response), JSON.stringify(album).slice(0, 40)).toEqual({
      status: 400,
      cacheControl: "no-store",
    });
  }

  expect(await upstreams.calls({ route: /^(youtube|cobalt)/u })).toHaveLength(0);
});

test("manifest updates keep the link and expiry, and only the permission holder can change or stop it", async ({
  request,
  upstreams,
}) => {
  const video = await upstreams.youtube.video();

  const manifest = albumManifest({
    title: "Original",
    artist: "A",
    artwork: "image/png",
    tracks: [{ video }],
  });

  const share = await createShare(request, manifest, "artwork");
  const before = await (await request.get(`/api/manifests/${share.slug}`)).json();
  expect(before.manifest.album.artwork).toMatchObject({ kind: "stored", format: "image/png" });
  expect(JSON.stringify(before)).not.toContain(share.revocationToken);

  const patch = (token: string | undefined, fields: Record<string, string>) =>
    request.patch(`/api/manifests/${share.slug}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      multipart: fields,
    });

  const renamed = albumManifest({
    title: "Renamed",
    artist: "A",
    artwork: "image/png",
    tracks: [{ video }],
  });

  expect((await patch(undefined, { manifest: JSON.stringify(renamed) })).status()).toBe(404);
  expect((await patch("wrong", { manifest: JSON.stringify(renamed) })).status()).toBe(404);
  expect(
    (
      await patch(share.revocationToken, { manifest: JSON.stringify(renamed), extra: "x" })
    ).status(),
  ).toBe(400);

  const updated = await patch(share.revocationToken, { manifest: JSON.stringify(renamed) });
  expect(updated.status()).toBe(200);
  expect(await updated.json()).toEqual({
    slug: share.slug,
    url: share.url,
    expiresAt: share.expiresAt,
    analyticsId: share.analyticsId,
  });
  const retained = await request.get(`/api/manifests/${share.slug}/artwork`);
  expect(new Uint8Array(await retained.body())).toEqual(imageBytes("artwork"));
  expect(
    (await (await request.get(`/api/manifests/${share.slug}`)).json()).manifest.album.title,
  ).toBe("Renamed");

  const bare = albumManifest({ title: "Bare", artist: "A", tracks: [{ video }] });
  expect(
    (
      await patch(share.revocationToken, { manifest: JSON.stringify(bare), removeArtwork: "true" })
    ).status(),
  ).toBe(200);
  expect((await request.get(`/api/manifests/${share.slug}/artwork`)).status()).toBe(404);

  const preview = await request.get(`/api/manifests/${share.slug}/preview-artwork`, {
    maxRedirects: 0,
  });

  expect(preview.status()).toBe(302);
  expect(preview.headers()["location"]).toBe(new URL("/icon-512.png", E2E_BASE_URL).href);

  const revoke = (token: string) =>
    request.delete(`/api/manifests/${share.slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

  expect((await revoke("wrong")).status()).toBe(404);
  expect((await revoke(share.revocationToken)).status()).toBe(204);
  expect((await revoke(share.revocationToken)).status()).toBe(204);
  expect((await request.get(`/api/manifests/${share.slug}`)).status()).toBe(404);
  expect((await patch(share.revocationToken, { manifest: JSON.stringify(bare) })).status()).toBe(
    404,
  );
});

test("manifest publication validates its contract and origin before storing anything", async ({
  request,
  upstreams,
}) => {
  const video = await upstreams.youtube.video();
  const valid = albumManifest({ title: "Valid", artist: "A", tracks: [{ video }] });

  const withTrack = (change: (track: (typeof valid)["tracks"][number]) => object) => ({
    ...valid,
    tracks: [change(valid.tracks[0]!)],
  });

  const post = (
    fields: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>,
    headers = {},
  ) => request.post("/api/manifests", { headers, multipart: fields });

  for (const manifest of [
    withTrack((track) => ({ ...track, sourceUrl: "https://example.com/audio.mp3" })),
    withTrack((track) => ({ ...track, sourceUrl: video.url.replace("https:", "http:") })),
    withTrack((track) => ({ ...track, audioBitrate: "999" })),
    withTrack((track) => ({ ...track, metadata: { ...track.metadata, year: 99_999 } })),
    withTrack((track) => ({ ...track, metadata: { ...track.metadata, filename: "" } })),
    { ...valid, tracks: Array.from({ length: 101 }, () => valid.tracks[0]) },
    { ...valid, tracks: [] },
    { ...valid, version: 2 },
    withTrack((track) => ({ ...track, metadata: { ...track.metadata, title: "x".repeat(1025) } })),
  ]) {
    const response = await post({ manifest: JSON.stringify(manifest) });
    expect(noStoreStatus(response), JSON.stringify(manifest).slice(0, 200)).toEqual({
      status: 400,
      cacheControl: "no-store",
    });
  }

  expect((await post({ manifest: "{not json" })).status()).toBe(400);
  expect((await post({ manifest: JSON.stringify(valid), extra: "x" })).status()).toBe(400);
  const duplicate = new FormData();
  duplicate.append("manifest", JSON.stringify(valid));
  duplicate.append("manifest", JSON.stringify(valid));
  expect((await request.post("/api/manifests", { multipart: duplicate })).status()).toBe(400);
  expect(
    (await post({ manifest: JSON.stringify(valid) }, { Origin: "https://evil.example" })).status(),
  ).toBe(400);
  expect(
    (await post({ manifest: JSON.stringify(valid) }, { "Sec-Fetch-Site": "cross-site" })).status(),
  ).toBe(400);
  expect((await request.post("/api/manifests", { data: valid })).status()).toBe(400);
  const artwork = coverUpload("artwork");

  for (const buffer of [Buffer.from("not an image"), artwork.buffer.subarray(0, 64)]) {
    expect(
      (
        await post({
          manifest: JSON.stringify(valid),
          cover: { name: "cover.png", mimeType: "image/png", buffer },
        })
      ).status(),
    ).toBe(400);
  }

  const contentType = "multipart/form-data; boundary=e2e-boundary";
  expect(
    await uploadUntilAnswered(
      { "content-type": contentType, "content-length": String(MAX_PUBLICATION_BYTES + 1) },
      new Uint8Array(),
    ),
  ).toBe(400);
  expect(
    await uploadUntilAnswered(
      { "content-type": contentType, "transfer-encoding": "chunked" },
      new Uint8Array(MAX_PUBLICATION_BYTES + 1),
    ),
  ).toBe(400);

  const created = await post({ manifest: JSON.stringify(valid) });
  expect(created.status()).toBe(201);
  expect((await created.json()).slug).toMatch(/^[23456789abcdefghjkmnpqrstvwxyz]{6}$/u);
});

test("share reads, creates, updates and revocations are rate limited per client", async ({
  request,
  upstreams,
}) => {
  const video = await upstreams.youtube.video();
  const manifest = albumManifest({ title: "Limited", artist: "A", tracks: [{ video }] });
  const share = await createShare(request, manifest);
  const ip = randomIp();
  const headers = { "cf-connecting-ip": ip };

  for (const binding of [
    "SHARE_CREATE_RATE_LIMITER",
    "SHARE_READ_RATE_LIMITER",
    "SHARE_UPDATE_RATE_LIMITER",
    "SHARE_REVOKE_RATE_LIMITER",
  ]) {
    await upstreams.rateLimits.limit(binding, ip, 1);
  }

  expect((await request.get(`/api/manifests/${share.slug}`, { headers })).status()).toBe(200);
  expect(noStoreStatus(await request.get(`/api/manifests/${share.slug}`, { headers }))).toEqual({
    status: 429,
    cacheControl: "no-store",
  });
  expect((await request.get(`/api/manifests/${share.slug}`)).status()).toBe(200);

  const create = () =>
    request.post("/api/manifests", { headers, multipart: { manifest: JSON.stringify(manifest) } });

  expect((await create()).status()).toBe(201);
  expect(noStoreStatus(await create())).toEqual({ status: 429, cacheControl: "no-store" });

  const update = () =>
    request.patch(`/api/manifests/${share.slug}`, {
      headers: { ...headers, Authorization: `Bearer ${share.revocationToken}` },
      multipart: { manifest: JSON.stringify(manifest) },
    });

  expect((await update()).status()).toBe(200);
  expect((await update()).status()).toBe(429);

  const revoke = (token: string) =>
    request.delete(`/api/manifests/${share.slug}`, {
      headers: { ...headers, Authorization: `Bearer ${token}` },
    });

  expect((await revoke("wrong")).status()).toBe(404);
  expect((await revoke(share.revocationToken)).status()).toBe(429);
  expect((await request.get(`/api/manifests/${share.slug}`)).status()).toBe(200);
});
