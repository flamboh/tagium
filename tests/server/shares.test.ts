import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import artworkHandler from "../../server/api/manifests/[slug]/artwork.get";
import manifestHandler from "../../server/api/manifests/[slug].get";
import createHandler from "../../server/api/shares/index.post";
import type { ShareRuntimeEnv } from "../../server/utils/share-manifest-request";
import { isShareExpiryIso, type AlbumManifest } from "../../src/features/share/shareManifest";
import { createRuntime, event, png, request } from "../support/shareRuntime";

const albumPlaylistUrl = "https://music.youtube.com/playlist?list=OLAK5uy_album";

const lockupVideo = (videoId: string, title: string) => ({
  lockupViewModel: {
    contentId: videoId,
    contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
    metadata: { lockupMetadataViewModel: { title: { content: title } } },
  },
});

const youtubePlaylistHtml = [
  `<script>var ytInitialData = ${JSON.stringify({
    metadata: { playlistMetadataRenderer: { title: "Album - Imaginal Disk" } },
    sidebar: {
      videoOwner: { videoOwnerRenderer: { title: { runs: [{ text: "Magdalena Bay" }] } } },
    },
    contents: [
      lockupVideo("aaaaaaaaaaa", "She Looked Like Me!"),
      lockupVideo("bbbbbbbbbbb", "Killing Time / Reprise"),
    ],
  })};</script>`,
  `<script>ytcfg.set(${JSON.stringify({
    INNERTUBE_API_KEY: "api-key",
    INNERTUBE_CLIENT_VERSION: "2.20260708.00.00",
    INNERTUBE_CONTEXT: { client: { clientName: "WEB" } },
  })});</script>`,
].join("");

const stubYouTube = () => {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : new URL(input).toString();
    if (url.startsWith("https://www.youtube.com/playlist?")) {
      expect(new URL(url).searchParams.get("list")).toBe("OLAK5uy_album");
      return new Response(youtubePlaylistHtml);
    }
    expect(url).toContain("https://www.youtube.com/youtubei/v1/next?");
    return Response.json({
      contents: {
        twoColumnWatchNextResults: {
          results: {
            results: {
              contents: [
                { videoPrimaryInfoRenderer: { dateText: { simpleText: "Aug 23, 2024" } } },
              ],
            },
          },
        },
      },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const create = (
  fields: Record<string, string | File>,
  env: ShareRuntimeEnv,
  headers: HeadersInit = {},
) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return createHandler(
    event(request("https://tagium.test/api/shares", { method: "POST", body: form, headers }, env)),
  );
};

const readManifest = async (slug: string, env: ShareRuntimeEnv) => {
  const response = await manifestHandler(
    event(request(`https://tagium.test/api/manifests/${slug}`, {}, env), slug),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { manifest: AlbumManifest }).manifest;
};

describe("script share endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves a youtube music album playlist and publishes it like the web client would", async () => {
    const runtime = createRuntime();
    stubYouTube();

    const response = await create({ source: albumPlaylistUrl }, runtime.env);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const receipt = (await response.json()) as {
      slug: string;
      url: string;
      expiresAt: string;
      revocationToken: string;
      analyticsId: string;
    };
    expect(Object.keys(receipt).sort()).toEqual([
      "analyticsId",
      "expiresAt",
      "revocationToken",
      "slug",
      "url",
    ]);
    expect(receipt.url).toBe(`https://tagium.test/share/${receipt.slug}`);
    expect(isShareExpiryIso(receipt.expiresAt)).toBe(true);
    expect(runtime.artwork.size).toBe(0);
    expect(await readManifest(receipt.slug, runtime.env)).toEqual({
      version: 1,
      kind: "album",
      album: {
        title: "Album - Imaginal Disk",
        artist: "Magdalena Bay",
        genre: "",
        year: 2024,
        sourceUrl: "https://www.youtube.com/playlist?list=OLAK5uy_album",
      },
      tracks: [
        {
          sourceUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
          audioBitrate: "320",
          metadata: {
            filename: "She Looked Like Me!",
            title: "She Looked Like Me!",
            artist: "Magdalena Bay",
            album: "Album - Imaginal Disk",
            genre: "",
            year: 2024,
            trackNumber: 1,
          },
        },
        {
          sourceUrl: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
          audioBitrate: "320",
          metadata: {
            filename: "Killing Time - Reprise",
            title: "Killing Time / Reprise",
            artist: "Magdalena Bay",
            album: "Album - Imaginal Disk",
            genre: "",
            year: 2024,
            trackNumber: 2,
          },
        },
      ],
    });
  });

  it("applies album overrides to the album and every track, and stores an uploaded cover", async () => {
    const runtime = createRuntime();
    stubYouTube();

    const response = await create(
      {
        source: albumPlaylistUrl,
        album: JSON.stringify({ title: "Imaginal Disk", genre: "Pop", year: 2023 }),
        cover: new File([png], "cover.png", { type: "image/png" }),
      },
      runtime.env,
    );

    expect(response.status).toBe(201);
    const { slug } = (await response.json()) as { slug: string };
    const manifest = await readManifest(slug, runtime.env);
    expect(manifest.album).toMatchObject({
      title: "Imaginal Disk",
      artist: "Magdalena Bay",
      genre: "Pop",
      year: 2023,
      artwork: { kind: "stored", format: "image/png", type: 3, description: "album cover" },
    });
    expect(manifest.tracks.map((track) => track.metadata)).toEqual([
      expect.objectContaining({ album: "Imaginal Disk", genre: "Pop", year: 2023 }),
      expect.objectContaining({ album: "Imaginal Disk", genre: "Pop", year: 2023 }),
    ]);
    const artwork = await artworkHandler(
      event(request(`https://tagium.test/api/manifests/${slug}/artwork`, {}, runtime.env), slug),
    );
    expect(artwork.status).toBe(200);
    expect(new Uint8Array(await artwork.arrayBuffer())).toEqual(png);
  });

  it("publishes an indefinite share with a cover outside the expiring prefix", async () => {
    const runtime = createRuntime();
    stubYouTube();

    const response = await create(
      {
        source: albumPlaylistUrl,
        lifetime: "indefinite",
        cover: new File([png], "cover.png", { type: "image/png" }),
      },
      runtime.env,
    );

    expect(response.status).toBe(201);
    const receipt = (await response.json()) as { slug: string; expiresAt: string | null };
    expect(receipt.expiresAt).toBeNull();
    const record = runtime.records.get(receipt.slug)!;
    expect(record.expiresAt).toBeNull();
    expect(record.artworkKey).toMatch(new RegExp(`^permanent-shares/${receipt.slug}/`));
    const loaded = await manifestHandler(
      event(
        request(`https://tagium.test/api/manifests/${receipt.slug}`, {}, runtime.env),
        receipt.slug,
      ),
    );
    expect(loaded.status).toBe(200);
    expect(((await loaded.json()) as { expiresAt: string | null }).expiresAt).toBeNull();
  });

  it("resolves soundcloud sets with their genre and release year", async () => {
    const runtime = createRuntime();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : new URL(input).toString();
        if (url === "https://soundcloud.com/") {
          return new Response('{"hydratable":"apiClient","data":{"id":"client-id"}}');
        }
        expect(url).toContain("https://api-v2.soundcloud.com/resolve");
        return Response.json({
          kind: "playlist",
          title: " Album ",
          genre: " Electronic ",
          release_date: "2023-09-15T00:00:00Z",
          is_album: true,
          user: { username: " Artist " },
          tracks: [
            {
              id: 1,
              kind: "track",
              title: " Track ",
              permalink_url: "https://soundcloud.com/artist/track",
            },
          ],
        });
      }),
    );
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await create(
      { source: "https://soundcloud.com/artist/sets/album" },
      runtime.env,
    );

    expect(response.status).toBe(201);
    const { slug } = (await response.json()) as { slug: string };
    expect(await readManifest(slug, runtime.env)).toMatchObject({
      album: {
        title: "Album",
        artist: "Artist",
        genre: "Electronic",
        year: 2023,
        sourceUrl: "https://soundcloud.com/artist/sets/album",
      },
      tracks: [
        {
          sourceUrl: "https://soundcloud.com/artist/track",
          metadata: { filename: "Track", trackNumber: 1, genre: "Electronic" },
        },
      ],
    });
  });

  it.each([
    ["a single video", { source: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }],
    ["an arbitrary host", { source: "https://example.com/playlist?list=OLAK5uy_album" }],
    ["a missing source", { album: "{}" }],
    ["an unknown field", { source: albumPlaylistUrl, manifest: "{}" }],
    ["malformed album json", { source: albumPlaylistUrl, album: "{" }],
    ["unknown album keys", { source: albumPlaylistUrl, album: '{"coverUrl":"https://x.test"}' }],
    ["an unknown lifetime", { source: albumPlaylistUrl, lifetime: "forever" }],
    [
      "an invalid cover",
      { source: albumPlaylistUrl, cover: new File(["nope"], "cover.png", { type: "image/png" }) },
    ],
  ])("rejects %s before contacting providers", async (_name, fields) => {
    const runtime = createRuntime();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await create(fields, runtime.env);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runtime.records.size).toBe(0);
  });

  it("rejects out-of-range album overrides without publishing", async () => {
    const runtime = createRuntime();
    stubYouTube();

    const response = await create(
      { source: albumPlaylistUrl, album: JSON.stringify({ year: 12 }) },
      runtime.env,
    );

    expect(response.status).toBe(400);
    expect(runtime.records.size).toBe(0);
  });

  it("reports unresolvable sources as bad input", async () => {
    const runtime = createRuntime();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await create({ source: albumPlaylistUrl }, runtime.env);

    expect(response.status).toBe(400);
    expect(runtime.records.size).toBe(0);
  });

  it("enforces rate limits, storage availability, and browser origin before resolving", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const runtime = createRuntime();

    const limited = await create(
      { source: albumPlaylistUrl },
      { ...runtime.env, SHARE_CREATE_RATE_LIMITER: { limit: async () => ({ success: false }) } },
    );
    const unavailable = await create({ source: albumPlaylistUrl }, {});
    const crossSite = await create({ source: albumPlaylistUrl }, runtime.env, {
      origin: "https://elsewhere.test",
    });

    expect([limited.status, unavailable.status, crossSite.status]).toEqual([429, 503, 400]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
