import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { HTTPError } from "nitro";
import { resolveSoundCloudSet } from "../../../server/utils/soundcloud-set";

const setUrl = "https://soundcloud.com/artist/sets/mixed";

const homeHtml =
  '<script>window.__sc_version="1700000000"</script><script>window.__sc_hydration = [{"hydratable":"apiClient","data":{"id":"clientid0000000000000000000000000"}}];</script>';

const fullTrack = (id: number) => ({
  id,
  kind: "track",
  title: `Track ${id}`,
  permalink_url: `https://soundcloud.com/artist/track-${id}`,
});

const stubSoundCloud = (tracks: unknown[], missingIds: number[], missingStatus = 404) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);

      if (url.hostname === "soundcloud.com") return new Response(homeHtml);

      if (url.pathname === "/resolve") {
        return Response.json({ kind: "playlist", title: "Mixed", tracks });
      }

      const id = Number(url.pathname.match(/^\/tracks\/(\d+)$/u)?.[1]);

      return missingIds.includes(id)
        ? Response.json({}, { status: missingStatus })
        : Response.json(fullTrack(id));
    }),
  );

const context = { requestId: "request-1" };

describe("soundcloud set resolution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports how many tracks it had to skip", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    stubSoundCloud([fullTrack(1), { id: 2, kind: "track" }, { id: 3, kind: "track" }, null], [3]);

    const set = await resolveSoundCloudSet(setUrl, context);

    expect(set.tracks.map((track) => track.trackNumber)).toEqual([1, 2]);
    expect(set).toMatchObject({ skippedCount: 2, truncated: false });
  });

  it("answers 422 when none of the set's tracks resolve", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    stubSoundCloud([{ id: 4, kind: "track" }], [4]);

    const error = await resolveSoundCloudSet(setUrl, context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(HTTPError);
    expect(error).toMatchObject({ status: 422, message: "soundcloud.no_resolvable_tracks" });
  });

  it("keeps a set retryable when its track lookups fail transiently", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    stubSoundCloud(
      [
        { id: 5, kind: "track" },
        { id: 6, kind: "track" },
      ],
      [5, 6],
      503,
    );

    const error = await resolveSoundCloudSet(setUrl, context).catch((cause: unknown) => cause);

    expect(error).toMatchObject({ status: 502, message: "soundcloud.no_resolvable_tracks" });
  });
});
