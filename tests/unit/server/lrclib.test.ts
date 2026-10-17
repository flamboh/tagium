import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  LrclibRequestError,
  lookupLyrics,
  pickSearchResult,
  searchQueries,
} from "../../../server/utils/lrclib";

const credentials = { appId: "app", apiKey: "key" };

type RecordFixture = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};

const record = (overrides: Partial<RecordFixture> = {}): RecordFixture => ({
  id: 1,
  trackName: "Song",
  artistName: "Artist",
  albumName: "Album",
  duration: 200,
  instrumental: false,
  plainLyrics: "plain line",
  syncedLyrics: "[00:01.00] synced line",
  ...overrides,
});

const json = (
  body: RecordFixture | RecordFixture[] | { name: string },
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const stubFetch = (...responses: Response[]) => {
  const requests: Request[] = [];

  const fetch = vi.fn(async (input: URL, init?: RequestInit) => {
    requests.push(new Request(input, init));

    return responses.shift() ?? new Response("exhausted", { status: 599 });
  });

  vi.stubGlobal("fetch", fetch);

  return requests;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lrclib search results", () => {
  it("keeps records within two seconds and prefers synced, then plain lyrics", () => {
    expect(
      pickSearchResult(
        [
          record({ duration: 230, syncedLyrics: "[00:01.00] wrong length" }),
          record({ duration: 201, syncedLyrics: null, plainLyrics: "plain only" }),
          record({ duration: 199, syncedLyrics: "[00:01.00] best" }),
        ],
        200,
      ),
    ).toEqual({ status: "found", lyrics: "[00:01.00] best", synced: true });

    expect(pickSearchResult([record({ duration: 230 })], 200)).toEqual({ status: "missing" });
    expect(pickSearchResult([record({ duration: 215 })], 200)).toEqual({
      status: "found",
      lyrics: "plain line",
      synced: false,
    });
    expect(pickSearchResult([record({ instrumental: true, plainLyrics: null })], 200)).toEqual({
      status: "instrumental",
    });
  });
});

describe("lrclib lookup", () => {
  it("matches by signature and identifies tagium with its registered app", async () => {
    const requests = stubFetch(json(record()));

    await expect(
      Effect.runPromise(
        lookupLyrics(credentials, {
          title: "Song",
          artist: "Artist",
          album: "Album",
          duration: 200.4,
        }),
      ),
    ).resolves.toEqual({ status: "found", lyrics: "[00:01.00] synced line", synced: true });

    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe("/api/get");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      track_name: "Song",
      artist_name: "Artist",
      album_name: "Album",
      duration: "200",
    });
    expect(requests[0]!.headers.get("lrclib-app-id")).toBe("app");
    expect(requests[0]!.headers.get("lrclib-api-key")).toBe("key");
    expect(requests[0]!.headers.get("user-agent")).toContain("tagium");
  });

  it("falls back to a search filtered by duration when the signature misses", async () => {
    const requests = stubFetch(
      json({ name: "TrackNotFound" }, 404),
      json([record({ duration: 260 }), record({ duration: 201, syncedLyrics: null })]),
    );

    await expect(
      Effect.runPromise(
        lookupLyrics(credentials, { title: "Song", artist: "Artist", duration: 200 }),
      ),
    ).resolves.toEqual({ status: "found", lyrics: "plain line", synced: false });
    expect(new URL(requests[1]!.url).pathname).toBe("/api/search");
  });

  it("keeps searching for synced lyrics when the signature match is plain", async () => {
    stubFetch(
      json(record({ syncedLyrics: null })),
      json([record({ duration: 201, syncedLyrics: "[00:01.00] searched" })]),
    );

    await expect(
      Effect.runPromise(
        lookupLyrics(credentials, { title: "Song", artist: "Artist", duration: 200 }),
      ),
    ).resolves.toEqual({ status: "found", lyrics: "[00:01.00] searched", synced: true });
  });

  it("also searches without a featured artist or a version suffix", async () => {
    const requests = stubFetch(
      json({ name: "TrackNotFound" }, 404),
      json([]),
      json([record({ syncedLyrics: "[00:01.00] simplified" })]),
    );

    await expect(
      Effect.runPromise(
        lookupLyrics(credentials, {
          title: "Song (feat. Guest) - 2011 Remaster",
          artist: "Artist",
          duration: 200,
        }),
      ),
    ).resolves.toMatchObject({ lyrics: "[00:01.00] simplified" });
    expect(new URL(requests[2]!.url).searchParams.get("track_name")).toBe("Song");
  });

  it("splits an artist out of a reposted artist - title upload", () => {
    expect(searchQueries({ title: "LOONA - Hi High", artist: "naemii." })).toEqual([
      { title: "LOONA - Hi High", artist: "naemii." },
      { title: "Hi High", artist: "LOONA" },
    ]);
    expect(searchQueries({ title: "Song - 2011 Remaster", artist: "Artist" })).toEqual([
      { title: "Song - 2011 Remaster", artist: "Artist" },
      { title: "Song", artist: "Artist" },
    ]);
  });

  it("searches straight away for a track too long for a signature match", async () => {
    const requests = stubFetch(json([record({ duration: 200 })]));

    await expect(
      Effect.runPromise(
        lookupLyrics(credentials, { title: "Song", artist: "Artist", duration: 7200 }),
      ),
    ).resolves.toEqual({ status: "missing" });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(["/api/search"]);
  });

  it("waits out a busy server before giving up", async () => {
    vi.useFakeTimers();

    try {
      const requests = stubFetch(
        json({ name: "ServerOverloaded" }, 503, { "retry-after": "1" }),
        json(record({ instrumental: true, plainLyrics: null, syncedLyrics: null })),
      );

      const lookup = Effect.runPromise(
        lookupLyrics(credentials, { title: "Song", artist: "Artist", duration: 200 }),
      );

      await vi.advanceTimersByTimeAsync(1_300);
      await expect(lookup).resolves.toEqual({ status: "instrumental" });
      expect(requests).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a rejected request instead of retrying it", async () => {
    stubFetch(json({ name: "InvalidApiKeyError" }, 401));

    const error = await Effect.runPromise(
      Effect.flip(lookupLyrics(credentials, { title: "Song", artist: "Artist", duration: 200 })),
    );

    expect(error).toBeInstanceOf(LrclibRequestError);
    expect(error).toMatchObject({ status: 401 });
  });
});
