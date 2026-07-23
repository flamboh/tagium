import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import handler from "../../server/api/soundcloud-set.get";

const makeEvent = (headers?: HeadersInit) => {
  const request = new Request(
    "https://tagium.test/api/soundcloud-set?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Fsets%2Falbum",
    { headers },
  );

  return { req: request } as unknown as Parameters<typeof handler>[0];
};

describe("soundcloud set endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns album kind and prefers release date for album year", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        let url = "";
        if (input instanceof Request) {
          url = input.url;
        } else {
          url = new URL(input).toString();
        }

        if (url === "https://soundcloud.com/") {
          return new Response(
            '<script>window.__sc_version="1234567890"</script>{"hydratable":"apiClient","data":{"id":"client-id"}}',
          );
        }

        expect(url).toContain("https://api-v2.soundcloud.com/resolve");

        return Response.json({
          kind: "playlist",
          title: " Album ",
          future_playlist_field: { is: "ignored" },
          genre: " Electronic ",
          display_date: "2024-05-01T00:00:00Z",
          release_date: "2023-09-15T00:00:00Z",
          is_album: true,
          set_type: "album",
          artwork_url: "https://i1.sndcdn.com/artworks-large.jpg",
          user: {
            username: " Artist ",
          },
          tracks: [
            {
              id: 1,
              kind: "track",
              title: " Track ",
              permalink_url: "https://soundcloud.com/artist/track",
              duration: 123,
              future_track_field: true,
            },
          ],
        });
      }),
    );

    await expect(handler(makeEvent())).resolves.toMatchObject({
      title: "Album",
      artist: "Artist",
      genre: "Electronic",
      year: 2023,
      isAlbum: true,
      coverUrl: "https://i1.sndcdn.com/artworks-t1080x1080.jpg",
      tracks: [
        {
          title: "Track",
          url: "https://soundcloud.com/artist/track",
          duration: 123,
          trackNumber: 1,
        },
      ],
    });
  });

  it("accepts null release date for playlist year", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        let url = "";
        if (input instanceof Request) {
          url = input.url;
        } else {
          url = new URL(input).toString();
        }

        if (url === "https://soundcloud.com/") {
          return new Response(
            '<script>window.__sc_version="1234567890"</script>{"hydratable":"apiClient","data":{"id":"client-id"}}',
          );
        }

        expect(url).toContain("https://api-v2.soundcloud.com/resolve");

        return Response.json({
          kind: "playlist",
          title: " Playlist ",
          genre: " Electronic ",
          display_date: "2024-05-01T00:00:00Z",
          release_date: null,
          is_album: false,
          set_type: "playlist",
          artwork_url: null,
          user: {
            username: " Artist ",
          },
          tracks: [
            {
              id: 1,
              kind: "track",
              title: " Track ",
              permalink_url: "https://soundcloud.com/artist/track",
              duration: 123,
            },
          ],
        });
      }),
    );

    await expect(handler(makeEvent())).resolves.toMatchObject({
      title: "Playlist",
      artist: "Artist",
      genre: "Electronic",
      year: 2024,
      isAlbum: false,
      tracks: [
        {
          title: "Track",
          url: "https://soundcloud.com/artist/track",
          duration: 123,
          trackNumber: 1,
        },
      ],
    });
  });

  it("falls back to track artwork when the playlist artwork is null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        let url = "";
        if (input instanceof Request) {
          url = input.url;
        } else {
          url = new URL(input).toString();
        }

        if (url === "https://soundcloud.com/") {
          return new Response(
            '<script>window.__sc_version="1234567890"</script>{"hydratable":"apiClient","data":{"id":"client-id"}}',
          );
        }

        expect(url).toContain("https://api-v2.soundcloud.com/resolve");

        return Response.json({
          kind: "playlist",
          title: "XCX WORLD",
          artwork_url: null,
          user: {
            username: "twvnkxcx",
          },
          tracks: [
            {
              id: 686556559,
              kind: "track",
              title: "Good Girls (XCX WORLD)",
              permalink_url: "https://soundcloud.com/siafan/good-girls-xcx-world",
              artwork_url: "https://i1.sndcdn.com/artworks-000603058507-5buc5j-large.jpg",
            },
          ],
        });
      }),
    );

    await expect(handler(makeEvent())).resolves.toMatchObject({
      coverUrl: "https://i1.sndcdn.com/artworks-000603058507-5buc5j-t1080x1080.jpg",
    });
  });

  it("logs playlist upstream failures with correlation but without the source URL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : new URL(input).toString();
        if (url === "https://soundcloud.com/") {
          return new Response(
            '<script>window.__sc_version="1234567890"</script>{"hydratable":"apiClient","data":{"id":"client-id"}}',
          );
        }
        return new Response("rate limited", {
          status: 429,
          headers: { "Content-Type": "text/html", "Retry-After": "30" },
        });
      }),
    );

    await expect(
      handler(
        makeEvent({
          "X-Tagium-Request-Id": "request-1",
          "X-Tagium-Import-Id": "import-1",
        }),
      ),
    ).rejects.toThrow("soundcloud.playlist.resolve_http_429");

    const event = warn.mock.calls
      .map(([entry]) => JSON.parse(entry))
      .find((entry) => entry.stage === "playlist.resolve_fetch");
    expect(event).toMatchObject({
      event: "soundcloud_upstream_failure",
      requestId: "request-1",
      importId: "import-1",
      stage: "playlist.resolve_fetch",
      upstreamStatus: 429,
      contentType: "text/html",
      retryAfter: "30",
    });
    expect(event.urlFingerprint).toMatch(/^sha256:[a-f0-9]{32}$/);
    expect(JSON.stringify(event)).not.toContain("soundcloud.com/artist/sets/album");
  });

  it("logs thrown playlist fetches once at the fetch stage", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : new URL(input).toString();
        if (url === "https://soundcloud.com/") {
          return new Response(
            '<script>window.__sc_version="1234567890"</script>{"hydratable":"apiClient","data":{"id":"client-id"}}',
          );
        }
        throw new TypeError("network unavailable");
      }),
    );

    await expect(handler(makeEvent({ "X-Tagium-Request-Id": "request-throw" }))).rejects.toThrow(
      "network unavailable",
    );

    const failures = warn.mock.calls
      .map(([entry]) => JSON.parse(entry))
      .filter((entry) => entry.event === "soundcloud_upstream_failure");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      requestId: "request-throw",
      stage: "playlist.resolve_fetch",
      errorType: "TypeError",
    });
  });

  it("logs partial track failures and an aggregate completion", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : new URL(input).toString();
        if (url === "https://soundcloud.com/") {
          return new Response(
            '<script>window.__sc_version="1234567890"</script>{"hydratable":"apiClient","data":{"id":"client-id"}}',
          );
        }
        if (url.startsWith("https://api-v2.soundcloud.com/tracks/2")) {
          return new Response("unavailable", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          });
        }
        return Response.json({
          kind: "playlist",
          title: "Album",
          user: { username: "Artist" },
          tracks: [
            {
              id: 1,
              kind: "track",
              title: "Resolved",
              permalink_url: "https://soundcloud.com/artist/resolved",
            },
            null,
            { id: 2, kind: "track" },
            {
              id: 3,
              kind: "track",
              title: "Still Resolved",
              permalink_url: "https://soundcloud.com/artist/still-resolved",
            },
          ],
        });
      }),
    );

    const result = await handler(
      makeEvent({
        "X-Tagium-Request-Id": "request-2",
        "X-Tagium-Import-Id": "import-2",
      }),
    );

    expect(result.tracks).toMatchObject([
      { title: "Resolved", trackNumber: 1 },
      { title: "Still Resolved", trackNumber: 4 },
    ]);
    const failure = warn.mock.calls
      .map(([entry]) => JSON.parse(entry))
      .find((entry) => entry.stage === "track.resolve_fetch");
    expect(failure).toMatchObject({
      requestId: "request-2",
      importId: "import-2",
      trackIndex: 3,
      upstreamStatus: 503,
    });
    const completion = info.mock.calls
      .map(([entry]) => JSON.parse(entry))
      .find((entry) => entry.event === "soundcloud_set_completion");
    expect(completion).toMatchObject({
      requestId: "request-2",
      importId: "import-2",
      trackCount: 4,
      succeeded: 2,
      failed: 2,
      failuresByStage: { "track.entry_parse": 1, "track.resolve_fetch": 1 },
    });
    const decodeFailure = warn.mock.calls
      .map(([entry]) => JSON.parse(entry))
      .find((entry) => entry.stage === "track.entry_parse");
    expect(decodeFailure).toMatchObject({
      requestId: "request-2",
      importId: "import-2",
      trackIndex: 2,
    });
  });
});
