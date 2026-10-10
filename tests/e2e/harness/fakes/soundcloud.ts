import { Buffer } from "node:buffer";
import {
  FAKE_SOUNDCLOUD_CLIENT_ID,
  mediaKeyFromUrl,
  shortLinkKey,
  type MediaScenario,
  type SoundCloudSetScenario,
} from "../protocol.ts";
import { html, imageResponse, json } from "./assets.ts";
import { unexpected, type FakeRequest, type FakeResult } from "./types.ts";

const artworkUrl = (key: string, hasArtwork: boolean) =>
  hasArtwork
    ? `https://i1.sndcdn.com/artworks-${Buffer.from(key).toString("hex")}-large.jpg`
    : null;

const trackJson = (scenario: MediaScenario) => ({
  id: scenario.soundcloudId,
  kind: "track",
  title: scenario.title,
  permalink_url: scenario.sourceUrl,
  duration: scenario.durationSec * 1000,
  artwork_url: artworkUrl(scenario.key, scenario.cover !== null),
  genre: scenario.genre ?? "",
  display_date: scenario.year === undefined ? undefined : `${scenario.year}-01-01T00:00:00Z`,
  user: { username: scenario.author },
});

const setJson = (request: FakeRequest, set: SoundCloudSetScenario) => ({
  kind: "playlist",
  title: set.title,
  genre: set.genre,
  display_date: set.displayDate,
  release_date: set.releaseDate ?? null,
  is_album: set.isAlbum,
  set_type: set.isAlbum ? "album" : "playlist",
  artwork_url: artworkUrl(set.key, set.artwork !== null),
  user: { username: set.author },
  tracks: set.tracks.flatMap(({ key, stub }) => {
    const track = request.registry.media(key);

    if (!track) return [];

    return [stub ? { id: track.soundcloudId, kind: "track" } : trackJson(track)];
  }),
});

const homeHtml = `<!doctype html><html><head><script>window.__sc_version="1700000000"</script></head><body><script>window.__sc_hydration = [{"hydratable":"apiClient","data":{"id":"${FAKE_SOUNDCLOUD_CLIENT_ID}","isExpiring":false}}];</script></body></html>`;

export const fakeSoundCloudWeb = (request: FakeRequest): FakeResult => {
  if (request.method !== "GET") return unexpected("soundcloud.web.unknown_route");

  if (request.url.pathname === "/") {
    return { route: "soundcloud.home", key: null, response: html(homeHtml) };
  }

  const key = mediaKeyFromUrl(request.url.toString());
  const scenario = request.registry.get(key);

  if (scenario?.type !== "media" && scenario?.type !== "soundcloud-set") {
    return unexpected("soundcloud.page", key);
  }

  return {
    route: "soundcloud.page",
    key,
    response: html(`<html><title>${scenario.title}</title></html>`),
  };
};

export const fakeSoundCloudApi = (request: FakeRequest): FakeResult => {
  const { url, registry } = request;

  if (request.method !== "GET") return unexpected("soundcloud.api.unknown_route");

  if (url.searchParams.get("client_id") !== FAKE_SOUNDCLOUD_CLIENT_ID) {
    return unexpected("soundcloud.api.client_id");
  }

  if (url.pathname === "/resolve") {
    const key = mediaKeyFromUrl(url.searchParams.get("url") ?? "");
    const scenario = registry.get(key);

    if (scenario?.type === "media") {
      return {
        route: "soundcloud.resolve.track",
        key,
        response:
          scenario.metadata.kind === "status"
            ? json({}, { status: scenario.metadata.status })
            : json(trackJson(scenario)),
      };
    }

    if (scenario?.type === "soundcloud-set") {
      return {
        route: "soundcloud.resolve.set",
        key,
        response: scenario.status
          ? json({}, { status: scenario.status })
          : json(setJson(request, scenario)),
      };
    }

    return unexpected("soundcloud.resolve", key);
  }

  const trackId = url.pathname.match(/^\/tracks\/(\d+)$/u)?.[1];

  if (trackId) {
    const scenario = registry.mediaBySoundCloudId(Number(trackId));

    if (!scenario) return unexpected("soundcloud.track");

    return { route: "soundcloud.track", key: scenario.key, response: json(trackJson(scenario)) };
  }

  return unexpected("soundcloud.api.unknown_route");
};

export const fakeSoundCloudArtwork = (request: FakeRequest): FakeResult => {
  const token = request.url.pathname.match(/^\/artworks-([a-f0-9]+)-/u)?.[1];
  const key = token ? Buffer.from(token, "hex").toString() : null;
  const scenario = request.registry.get(key);

  const image =
    scenario?.type === "media"
      ? scenario.cover
      : scenario?.type === "soundcloud-set"
        ? scenario.artwork
        : null;

  if (!image) return unexpected("sndcdn.artwork", key);

  return { route: "sndcdn.artwork", key, response: imageResponse(image) };
};

export const fakeSoundCloudShortLink = (request: FakeRequest): FakeResult => {
  const key = shortLinkKey(request.url);
  const scenario = request.registry.get(key);

  if (scenario?.type !== "short-link") return unexpected("soundcloud.short_link", key);

  return {
    route: "soundcloud.short_link",
    key,
    response: new Response(null, { status: 302, headers: { location: scenario.location } }),
  };
};
