import { randomBytes, randomInt } from "node:crypto";
import type { AudioFixtureName, ImageFixtureName } from "../fixtures/catalog.ts";
import {
  E2E_CONTROL_URL,
  mediaKeyFromUrl,
  shortLinkKey,
  soundcloudKey,
  youtubePlaylistKey,
  youtubeVideoKey,
  type CobaltBehavior,
  type MediaScenario,
  type MetadataBehavior,
  type RateLimitRule,
  type Scenario,
  type Sequence,
  type TunnelBehavior,
  type UpstreamCall,
} from "../harness/protocol.ts";

export type MediaOptions = {
  title?: string;
  author?: string;
  durationSec?: number;
  audio?: AudioFixtureName;
  cover?: ImageFixtureName | null;
  year?: number;
  genre?: string;
  album?: string;
  metadata?: MetadataBehavior;
  cobalt?: Sequence<CobaltBehavior>;
  tunnel?: Sequence<TunnelBehavior>;
};

export type YouTubeVideoOptions = MediaOptions & { id?: string };
export type SoundCloudTrackOptions = MediaOptions & { user?: string; slug?: string; id?: number };

export type FakeMedia = {
  key: string;
  url: string;
  title: string;
  author: string;
  durationSec: number;
  year: number | undefined;
};
export type FakeYouTubeVideo = FakeMedia & { id: string; shortUrl: string };
export type FakeSoundCloudTrack = FakeMedia & { id: number };

const token = (bytes: number) => randomBytes(bytes).toString("hex");

export const createUpstreams = (owner: string) => {
  const post = async (
    path: string,
    body:
      | { scenarios: Scenario[] }
      | { key: string; cobalt?: Sequence<CobaltBehavior>; tunnel?: Sequence<TunnelBehavior> }
      | { rule: RateLimitRule }
      | Record<never, never>,
  ) => {
    const response = await fetch(`${E2E_CONTROL_URL}${path}`, {
      method: "POST",
      body: JSON.stringify({ owner, ...body }),
    });
    if (!response.ok) {
      throw new Error(`e2e harness ${path} failed (${response.status}): ${await response.text()}`);
    }
  };
  const register = (scenarios: Scenario[]) => post("/scenarios", { scenarios });
  const keyFor = (url: string) => {
    const key = mediaKeyFromUrl(url);
    if (!key) throw new Error(`no fake upstream key for ${url}`);
    return key;
  };
  const describe = (scenario: MediaScenario): FakeMedia => ({
    key: scenario.key,
    url: scenario.sourceUrl,
    title: scenario.title,
    author: scenario.author,
    durationSec: scenario.durationSec,
    year: scenario.year,
  });

  const youtubeVideoScenario = (options: YouTubeVideoOptions = {}) => {
    const id = options.id ?? randomBytes(8).toString("base64url");
    const scenario: MediaScenario = {
      type: "media",
      key: youtubeVideoKey(id),
      service: "youtube",
      sourceUrl: `https://www.youtube.com/watch?v=${id}`,
      title: options.title ?? "Fixture Video",
      author: options.author ?? "Fixture Channel",
      durationSec: options.durationSec ?? 2,
      audio: options.audio ?? "m4a",
      cover: options.cover === undefined ? "thumbnail" : options.cover,
      year: options.year,
      metadata: options.metadata ?? { kind: "ok" },
      cobalt: options.cobalt ?? { kind: "ok" },
      tunnel: options.tunnel ?? { kind: "ok" },
    };
    const video: FakeYouTubeVideo = {
      ...describe(scenario),
      id,
      shortUrl: `https://youtu.be/${id}`,
    };
    return { scenario, video };
  };

  const soundcloudTrackScenario = (options: SoundCloudTrackOptions = {}) => {
    const user = options.user ?? `e2e-artist-${token(4)}`;
    const slug = options.slug ?? `track-${token(4)}`;
    const pathname = `/${user}/${slug}`;
    const scenario: MediaScenario = {
      type: "media",
      key: soundcloudKey(pathname),
      service: "soundcloud",
      sourceUrl: `https://soundcloud.com${pathname}`,
      title: options.title ?? "Fixture Track",
      author: options.author ?? "Fixture Artist",
      durationSec: options.durationSec ?? 2,
      audio: options.audio ?? "opus",
      cover: options.cover === undefined ? "artwork" : options.cover,
      year: options.year,
      genre: options.genre,
      album: options.album,
      soundcloudId: options.id ?? randomInt(100_000_000, 2_000_000_000),
      metadata: options.metadata ?? { kind: "ok" },
      cobalt: options.cobalt ?? { kind: "ok" },
      tunnel: options.tunnel ?? { kind: "ok" },
    };
    const track: FakeSoundCloudTrack = { ...describe(scenario), id: scenario.soundcloudId! };
    return { scenario, track };
  };

  const overrideCobalt = (url: string, cobalt: Sequence<CobaltBehavior>) =>
    post("/overrides", { key: keyFor(url), cobalt });
  const overrideTunnel = (url: string, tunnel: Sequence<TunnelBehavior>) =>
    post("/overrides", { key: keyFor(url), tunnel });
  const repeat = <T>(behavior: T, times: number | undefined, then: T): Sequence<T> =>
    times === undefined ? behavior : [...Array.from({ length: times }, () => behavior), then];

  return {
    owner,
    youtube: {
      async video(options: YouTubeVideoOptions = {}) {
        const { scenario, video } = youtubeVideoScenario(options);
        await register([scenario]);
        return video;
      },
      async missingVideo(options: YouTubeVideoOptions = {}) {
        return this.video({
          metadata: { kind: "status", status: 404 },
          cobalt: { kind: "error", code: "error.api.content.video.unavailable" },
          ...options,
        });
      },
      async playlist(options: {
        id?: string;
        title?: string;
        author?: string;
        videos: YouTubeVideoOptions[];
        pageSize?: number;
        status?: number;
      }) {
        const id = options.id ?? `PLe2e${randomBytes(12).toString("base64url")}`;
        const videos = options.videos.map((video) => youtubeVideoScenario(video));
        const playlist = {
          type: "youtube-playlist" as const,
          key: youtubePlaylistKey(id),
          playlistId: id,
          title: options.title ?? "Fixture Playlist",
          author: options.author ?? "Fixture Channel",
          videoKeys: videos.map(({ scenario }) => scenario.key),
          pageSize: options.pageSize ?? 100,
          status: options.status,
        };
        await register([...videos.map(({ scenario }) => scenario), playlist]);
        return {
          id,
          key: playlist.key,
          url: `https://www.youtube.com/playlist?list=${id}`,
          title: playlist.title,
          author: playlist.author,
          videos: videos.map(({ video }) => video),
        };
      },
    },
    soundcloud: {
      async track(options: SoundCloudTrackOptions = {}) {
        const { scenario, track } = soundcloudTrackScenario(options);
        await register([scenario]);
        return track;
      },
      async set(options: {
        user?: string;
        slug?: string;
        title?: string;
        author?: string;
        genre?: string;
        isAlbum?: boolean;
        displayDate?: string;
        releaseDate?: string;
        artwork?: ImageFixtureName | null;
        tracks: (SoundCloudTrackOptions & { stub?: boolean })[];
        status?: number;
      }) {
        const user = options.user ?? `e2e-artist-${token(4)}`;
        const pathname = `/${user}/sets/${options.slug ?? `set-${token(4)}`}`;
        const tracks = options.tracks.map((track) => ({
          ...soundcloudTrackScenario({ user, ...track }),
          stub: track.stub === true,
        }));
        const set = {
          type: "soundcloud-set" as const,
          key: soundcloudKey(pathname),
          sourceUrl: `https://soundcloud.com${pathname}`,
          title: options.title ?? "Fixture Set",
          author: options.author ?? "Fixture Artist",
          genre: options.genre ?? "",
          displayDate: options.displayDate,
          releaseDate: options.releaseDate,
          isAlbum: options.isAlbum ?? false,
          artwork: options.artwork === undefined ? "artwork" : options.artwork,
          tracks: tracks.map(({ scenario, stub }) => ({ key: scenario.key, stub })),
          status: options.status,
        };
        await register([...tracks.map(({ scenario }) => scenario), set]);
        return {
          key: set.key,
          url: set.sourceUrl,
          title: set.title,
          author: set.author,
          tracks: tracks.map(({ track }) => track),
        };
      },
      async shortLink(target: string) {
        const url = new URL(`https://on.soundcloud.com/${token(5)}`);
        await register([{ type: "short-link", key: shortLinkKey(url), location: target }]);
        return url.toString();
      },
    },
    cobalt: {
      respond: overrideCobalt,
      fail: (url: string, code: string, status = 400) =>
        overrideCobalt(url, { kind: "error", code, status }),
      capacity: (url: string, options: { retryAfter?: string; times?: number } = {}) =>
        overrideCobalt(
          url,
          repeat<CobaltBehavior>(
            { kind: "capacity", retryAfter: options.retryAfter },
            options.times,
            { kind: "ok" },
          ),
        ),
      hang: (url: string) => overrideCobalt(url, { kind: "hang" }),
      tunnel: overrideTunnel,
      emptyTunnel: (url: string, times?: number) =>
        overrideTunnel(url, repeat<TunnelBehavior>({ kind: "empty" }, times, { kind: "ok" })),
      slowTunnel: (url: string, delayMs: number) => overrideTunnel(url, { kind: "ok", delayMs }),
      hangTunnel: (url: string) => overrideTunnel(url, { kind: "hang" }),
    },
    rateLimits: {
      limit: (binding: string, key: string, limit: RateLimitRule["limit"]) =>
        post("/rate-limits", { rule: { binding, key, limit } }),
    },
    async calls(filter: { route?: string | RegExp; key?: string; unexpected?: boolean } = {}) {
      const params = new URLSearchParams({ owner });
      if (filter.unexpected !== undefined) params.set("unexpected", filter.unexpected ? "1" : "0");
      const response = await fetch(`${E2E_CONTROL_URL}/calls?${params}`);
      const calls = (await response.json()) as UpstreamCall[];
      return calls.filter(
        (call) =>
          (filter.key === undefined || call.key === filter.key) &&
          (filter.route === undefined ||
            (typeof filter.route === "string"
              ? call.route === filter.route
              : filter.route.test(call.route))),
      );
    },
    async unexpectedCallsSince(since: number) {
      const params = new URLSearchParams({
        owner,
        includeUnowned: "1",
        unexpected: "1",
        since: String(since),
      });
      const response = await fetch(`${E2E_CONTROL_URL}/calls?${params}`);
      return (await response.json()) as UpstreamCall[];
    },
    release: () => post("/release", {}),
  };
};

export type Upstreams = ReturnType<typeof createUpstreams>;
