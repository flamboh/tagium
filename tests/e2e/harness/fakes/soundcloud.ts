import { Match } from "effect";
import { Buffer } from "node:buffer";
import {
  FAKE_SOUNDCLOUD_CLIENT_ID,
  FAKE_SOUNDCLOUD_PLAYBACK_ORIGIN,
  mediaKeyFromUrl,
  shortLinkKey,
  type MediaScenario,
  type SoundCloudSetScenario,
} from "../protocol.ts";
import { html, imageResponse, json, sleep, soundcloudHlsResponse } from "./assets.ts";
import { hangThenFail, unexpected, type FakeRequest, type FakeResult } from "./types.ts";

const artworkUrl = (key: string, hasArtwork: boolean) =>
  hasArtwork
    ? `https://i1.sndcdn.com/artworks-${Buffer.from(key).toString("hex")}-large.jpg`
    : null;

const keyToken = (key: string) => Buffer.from(key).toString("hex");

const transcoding = (scenario: MediaScenario, preset: string, protocol = "hls") => ({
  url: `https://api-v2.soundcloud.com/media/soundcloud:tracks:${scenario.soundcloudId}/${preset}/stream/${protocol}`,
  preset,
  duration: scenario.durationSec * 1000,
  snipped: false,
  format: { protocol, mime_type: 'audio/mp4; codecs="mp4a.40.2"' },
  quality: "sq",
});

const transcodings = (scenario: MediaScenario) => {
  switch (scenario.soundcloudTranscodings ?? "aac") {
    case "aac":
      return [
        transcoding(scenario, "aac_160k"),
        transcoding(scenario, "aac_96k"),
        transcoding(scenario, "abr_sq"),
      ];
    case "encrypted":
      return [transcoding(scenario, "aac_160k", "ctr-encrypted-hls")];
    case "legacy":
      return [transcoding(scenario, "abr_sq")];
  }
};

const trackAuthorization = (scenario: MediaScenario) => `e2e-auth-${scenario.soundcloudId}`;

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
  publisher_metadata: scenario.album ? { album_title: scenario.album } : null,
  policy: scenario.soundcloudPolicy ?? "ALLOW",
  track_authorization: trackAuthorization(scenario),
  media: { transcodings: transcodings(scenario) },
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

  const media = url.pathname.match(
    /^\/media\/soundcloud:tracks:(\d+)\/([a-z0-9_]+)\/stream\/hls$/u,
  );

  if (media) {
    const scenario = registry.mediaBySoundCloudId(Number(media[1]));

    if (!scenario) return unexpected("soundcloud.stream");

    if (url.searchParams.get("track_authorization") !== trackAuthorization(scenario)) {
      return unexpected("soundcloud.stream.track_authorization", scenario.key);
    }

    const respond = (response: Response | Promise<Response>): FakeResult => ({
      route: "soundcloud.stream",
      key: scenario.key,
      response,
    });

    const behavior = registry.nextSoundCloudStream(scenario.key);

    switch (behavior.kind) {
      case "ok":
        return respond(
          json({
            url: `${FAKE_SOUNDCLOUD_PLAYBACK_ORIGIN}/${keyToken(scenario.key)}/${media[2]}/soundcloud.m3u8?expires=1`,
          }),
        );
      case "status":
        return respond(json({}, { status: behavior.status }));
      case "hang":
        return respond(hangThenFail(registry, scenario.key));
    }
  }

  return unexpected("soundcloud.api.unknown_route");
};

export const fakeSoundCloudPlayback = (request: FakeRequest): FakeResult => {
  const [, token, , file] = request.url.pathname.split("/");
  const key = token ? Buffer.from(token, "hex").toString() : null;
  const scenario = request.registry.media(key);
  const body = file ? soundcloudHlsResponse(file) : undefined;

  if (request.method !== "GET" || !scenario || !body) {
    return unexpected("soundcloud.playback", key);
  }

  if (file!.endsWith(".m3u8")) return { route: "soundcloud.playlist", key, response: body };

  const respond = (response: Response | Promise<Response>): FakeResult => ({
    route: "soundcloud.segment",
    key,
    response,
  });

  const behavior = request.registry.nextTunnel(scenario.key) ?? { kind: "ok" };

  switch (behavior.kind) {
    case "ok":
      return respond(sleep(behavior.delayMs ?? 0).then(() => body));
    case "empty":
      return respond(new Response(new Uint8Array(), { headers: { "content-type": "audio/mp4" } }));
    case "capacity":
      return respond(new Response(null, { status: 503 }));
    case "status":
      return respond(new Response(behavior.body ?? "", { status: behavior.status }));
    case "stall":
    case "hang":
      return respond(hangThenFail(request.registry, scenario.key));
  }
};

export const fakeSoundCloudArtwork = (request: FakeRequest): FakeResult => {
  const token = request.url.pathname.match(/^\/artworks-([a-f0-9]+)-/u)?.[1];
  const key = token ? Buffer.from(token, "hex").toString() : null;
  const scenario = request.registry.get(key);

  const image = Match.value(scenario).pipe(
    Match.when({ type: "media" }, (media) => media.cover),
    Match.when({ type: "soundcloud-set" }, (set) => set.artwork),
    Match.orElse(() => null),
  );

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
