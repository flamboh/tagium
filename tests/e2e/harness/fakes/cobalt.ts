import { createHash, randomBytes } from "node:crypto";
import { videoStreamFixtures, type VideoCodec } from "../../fixtures/catalog.ts";
import {
  FAKE_COBALT_API_KEY,
  FAKE_COBALT_MACHINE_ID,
  FAKE_COBALT_ORIGIN,
  FAKE_DIRECT_MEDIA_ORIGIN,
  mediaKeyFromUrl,
  type MediaScenario,
  type PostAsset,
  type PostScenario,
} from "../protocol.ts";
import type { Tunnel } from "../registry.ts";
import {
  assetResponse,
  audioResponse,
  imageResponse,
  json,
  stalledAssetResponse,
  sleep,
} from "./assets.ts";
import { hangThenFail, unexpected, type FakeRequest, type FakeResult } from "./types.ts";

const sanitize = (value: string) =>
  value.replace(/[<>:"/\\|?*]/gu, (character) =>
    String.fromCodePoint(character.codePointAt(0)! + 0xfee0),
  );

const mimeTypes = new Map([
  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
  ["opus", "audio/ogg"],
  ["ogg", "audio/ogg"],
  ["wav", "audio/wav"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
  ["mkv", "video/x-matroska"],
]);

const mimeType = (extension: string) => mimeTypes.get(extension) ?? "application/octet-stream";

type ResolveBody = {
  url?: string;
  audioFormat?: string;
  audioBitrate?: string;
  downloadMode?: string;
  youtubeVideoCodec?: string;
  youtubeVideoContainer?: string;
  videoQuality?: string;
};

const capacityError = (retryAfter = "2") =>
  json(
    { status: "error", error: { code: "error.api.capacity_exceeded" } },
    { status: 503, headers: { "retry-after": retryAfter } },
  );

const tunnelUrl = (id: string) => {
  const url = new URL("/tunnel", FAKE_COBALT_ORIGIN);
  const exp = String(Date.now() + 90_000);
  url.searchParams.set("id", id);
  url.searchParams.set("exp", exp);
  url.searchParams.set("sig", createHash("sha256").update(`${id},${exp}`).digest("base64url"));
  url.searchParams.set("sec", randomBytes(32).toString("base64url"));
  url.searchParams.set("iv", randomBytes(16).toString("base64url"));

  return url.toString();
};

const createTunnel = (request: FakeRequest, tunnel: Omit<Tunnel, "machineId">) =>
  request.registry.createTunnel({ ...tunnel, machineId: FAKE_COBALT_MACHINE_ID });

const youtubeStreams = (scenario: MediaScenario, codec: VideoCodec) =>
  (scenario.video ?? [])
    .map((name) => ({ name, ...videoStreamFixtures[name] }))
    .filter((stream) => stream.codec === codec)
    .sort((a, b) => b.height - a.height);

const youtubeAudioOnlyCodec = (scenario: MediaScenario): VideoCodec =>
  youtubeStreams(scenario, "vp9").length > 0
    ? "vp9"
    : youtubeStreams(scenario, "av1").length > 0
      ? "av1"
      : "h264";

const audioAssetFor = (codec: VideoCodec): PostAsset | undefined =>
  codec === "h264" ? undefined : "opus-webm";

const localProcessingPlan = (
  request: FakeRequest,
  scenario: MediaScenario,
  requested: ResolveBody,
) => {
  const best = requested.audioFormat === "best";
  const youtubeCodec = scenario.service === "youtube" ? youtubeAudioOnlyCodec(scenario) : "h264";

  const format = best
    ? scenario.service === "youtube"
      ? youtubeCodec === "h264"
        ? "m4a"
        : "opus"
      : scenario.audio !== "mp3"
        ? "opus"
        : "mp3"
    : (requested.audioFormat ?? "mp3");

  const type = scenario.service === "youtube" && best ? "proxy" : "audio";

  const tunnels = [
    tunnelUrl(
      createTunnel(request, {
        key: scenario.key,
        part: "audio",
        asset: audioAssetFor(youtubeCodec),
      }),
    ),
  ];

  if (scenario.cover) {
    tunnels.push(tunnelUrl(createTunnel(request, { key: scenario.key, part: "cover" })));
  }

  const metadata =
    scenario.service === "youtube"
      ? { title: scenario.title, artist: scenario.author }
      : {
          title: scenario.title,
          album: scenario.album,
          artist: scenario.author,
          album_artist: scenario.author,
          genre: scenario.genre,
          date: scenario.year === undefined ? undefined : `${scenario.year}-01-01`,
        };

  return {
    status: "local-processing",
    type,
    service: scenario.service,
    tunnel: tunnels,
    output: {
      type: mimeType(format),
      filename: `${sanitize(scenario.title)} - ${sanitize(scenario.author)} (${scenario.service}).${format}`,
      metadata,
    },
    audio: {
      copy: scenario.service === "soundcloud" && best,
      format,
      bitrate: requested.audioBitrate ?? "128",
      cover: scenario.cover ? true : undefined,
      cropCover: scenario.author.endsWith("- Topic") ? true : undefined,
    },
    isHLS: false,
  };
};

const isVideoCodec = (value: string | undefined): value is VideoCodec =>
  value === "h264" || value === "vp9" || value === "av1";

const youtubeVideoPlan = (
  request: FakeRequest,
  scenario: MediaScenario,
  requested: ResolveBody,
) => {
  let codec: VideoCodec = isVideoCodec(requested.youtubeVideoCodec)
    ? requested.youtubeVideoCodec
    : "h264";

  if (youtubeStreams(scenario, codec).length === 0) {
    codec = codec === "av1" ? "vp9" : codec === "vp9" ? "av1" : codec;
  }

  if (youtubeStreams(scenario, codec).length === 0) codec = "h264";
  const streams = youtubeStreams(scenario, codec);
  const best = streams[0];

  if (!best) return null;
  const quality = Number(requested.videoQuality ?? "1080");

  const video =
    quality >= best.height ? best : (streams.find((stream) => stream.height === quality) ?? best);

  const container =
    !requested.youtubeVideoContainer || requested.youtubeVideoContainer === "auto"
      ? codec === "h264"
        ? "mp4"
        : "webm"
      : requested.youtubeVideoContainer;

  const mute = requested.downloadMode === "mute";

  const tunnels = [
    tunnelUrl(createTunnel(request, { key: scenario.key, part: "video", asset: video.name })),
  ];

  if (!mute) {
    tunnels.push(
      tunnelUrl(
        createTunnel(request, { key: scenario.key, part: "audio", asset: audioAssetFor(codec) }),
      ),
    );
  }

  const tags = [`${video.height}p`, codec, ...(mute ? ["mute"] : []), "youtube"];

  return {
    status: "local-processing",
    type: mute ? "proxy" : "merge",
    service: "youtube",
    tunnel: tunnels,
    output: {
      type: mimeType(container),
      filename: `${sanitize(scenario.title)} - ${sanitize(scenario.author)} (${tags.join(", ")}).${container}`,
      metadata: { title: scenario.title, artist: scenario.author },
    },
    isHLS: false,
  };
};

const mediaPlan = (request: FakeRequest, scenario: MediaScenario, requested: ResolveBody) => {
  if (
    scenario.service === "youtube" &&
    scenario.video !== undefined &&
    requested.downloadMode !== "audio"
  ) {
    return (
      youtubeVideoPlan(request, scenario, requested) ?? {
        status: "error",
        error: { code: "error.api.youtube.no_matching_format" },
      }
    );
  }

  return localProcessingPlan(request, scenario, requested);
};

type PickerPlan = {
  status: "picker";
  picker: { type: string; url: string }[];
  audio?: string;
  audioFilename?: string;
};

const pickerExtensions = { photo: "jpg", video: "mp4", gif: "gif" } as const;

const postPlan = (request: FakeRequest, scenario: PostScenario) => {
  const postId = new URL(scenario.sourceUrl).pathname.split("/").at(-1);

  const resource = (asset: PostAsset, directFilename?: string, filename?: string) => {
    if (directFilename) {
      const id = createTunnel(request, { key: scenario.key, part: "post", asset });

      return `${FAKE_DIRECT_MEDIA_ORIGIN}/${id}/${encodeURIComponent(directFilename)}`;
    }

    return tunnelUrl(createTunnel(request, { key: scenario.key, part: "post", asset, filename }));
  };

  const { media } = scenario;

  if (media.kind === "gif") {
    return {
      status: "local-processing",
      type: "gif",
      service: "twitter",
      tunnel: [resource(media.asset)],
      output: { type: "image/gif", filename: media.filename },
      isHLS: false,
    };
  }

  const plan: PickerPlan = {
    status: "picker",
    picker: media.items.map((item, index) => ({
      type: item.type,
      url: resource(
        item.asset,
        item.directFilename,
        `twitter_${postId}_${index + 1}.${pickerExtensions[item.type]}`,
      ),
    })),
  };

  if (media.audio) {
    plan.audio = resource(media.audio.asset, undefined, media.audio.filename);
    plan.audioFilename = media.audio.filename;
  }

  return plan;
};

const resolve = (request: FakeRequest): FakeResult => {
  if (request.headers.get("authorization") !== `Api-Key ${FAKE_COBALT_API_KEY}`) {
    return {
      route: "cobalt.resolve",
      key: null,
      unexpected: true,
      response: json(
        { status: "error", error: { code: "error.api.auth.key.invalid" } },
        { status: 401 },
      ),
    };
  }

  let body: ResolveBody;

  try {
    body = JSON.parse(request.body ?? "");
  } catch {
    return unexpected("cobalt.resolve.invalid_body");
  }

  const key = body.url ? mediaKeyFromUrl(body.url) : null;
  const behavior = key ? request.registry.nextCobalt(key) : undefined;

  if (!key || !behavior) return unexpected("cobalt.resolve", key);

  const respond = (response: Response | Promise<Response>): FakeResult => ({
    route: "cobalt.resolve",
    key,
    response,
  });

  const machineHeaders = { "x-cobalt-machine-id": FAKE_COBALT_MACHINE_ID };

  switch (behavior.kind) {
    case "error":
      return respond(
        json(
          { status: "error", error: { code: behavior.code } },
          { status: behavior.status ?? 400, headers: machineHeaders },
        ),
      );
    case "capacity":
      return respond(capacityError(behavior.retryAfter));
    case "non-json":
      return respond(
        new Response("<html>bad gateway</html>", {
          status: behavior.status ?? 502,
          headers: { "content-type": "text/html" },
        }),
      );
    case "json":
      return respond(
        json(behavior.body, { status: behavior.status ?? 200, headers: machineHeaders }),
      );
    case "hang":
      return respond(hangThenFail(request.registry, key));
    case "invalid-machine-id":
    case "ok": {
      const media = request.registry.media(key);
      const post = request.registry.post(key);

      if (!media && !post) return unexpected("cobalt.resolve.no_media", key);
      const plan = media ? mediaPlan(request, media, body) : postPlan(request, post!);

      const headers = {
        "x-cobalt-machine-id": behavior.kind === "ok" ? FAKE_COBALT_MACHINE_ID : "Invalid Machine!",
      };

      const delayMs = behavior.kind === "ok" ? (behavior.delayMs ?? 0) : 0;

      return respond(sleep(delayMs).then(() => json(plan, { headers })));
    }
  }
};

const serveTunnel = (request: FakeRequest, entry: Tunnel, route: string): FakeResult => {
  const media = request.registry.media(entry.key);
  const post = request.registry.post(entry.key);

  if (!media && !post) return unexpected(`${route}.no_media`, entry.key);

  const respond = (response: Response | Promise<Response>): FakeResult => ({
    route,
    key: entry.key,
    response,
  });

  if (entry.part === "cover") {
    return media?.cover
      ? respond(imageResponse(media.cover))
      : unexpected("cobalt.tunnel.cover", entry.key);
  }

  const asset = entry.asset ?? media?.audio;

  if (!asset) return unexpected(`${route}.no_asset`, entry.key);

  const body = () => {
    const response = entry.asset ? assetResponse(entry.asset) : audioResponse(media!.audio);

    if (entry.filename) {
      response.headers.set("content-disposition", `attachment; filename="${entry.filename}"`);
    }

    return response;
  };

  const behavior = request.registry.nextTunnel(entry.key) ?? { kind: "ok" };

  switch (behavior.kind) {
    case "ok":
      return respond(sleep(behavior.delayMs ?? 0).then(body));
    case "empty":
      return respond(
        new Response(new Uint8Array(), {
          headers: { "content-type": "audio/mpeg", "content-length": "0" },
        }),
      );
    case "capacity":
      return respond(capacityError(behavior.retryAfter));
    case "status":
      return respond(new Response(behavior.body ?? "", { status: behavior.status }));
    case "stall":
      return respond(
        stalledAssetResponse(asset, behavior.bytes, () => request.registry.hang(entry.key)),
      );
    case "hang":
      return respond(hangThenFail(request.registry, entry.key));
  }
};

const tunnel = (request: FakeRequest): FakeResult => {
  const id = request.url.searchParams.get("id");
  const entry = request.registry.tunnel(id);

  if (!entry) return unexpected("cobalt.tunnel.unknown", request.registry.releasedTunnelKey(id));

  if (request.headers.get("fly-force-instance-id") !== entry.machineId) {
    return unexpected("cobalt.tunnel.machine_mismatch", entry.key);
  }

  return serveTunnel(request, entry, `cobalt.tunnel.${entry.part}`);
};

export const fakeDirectMedia = (request: FakeRequest): FakeResult => {
  const id = request.url.pathname.split("/")[1] ?? null;
  const entry = request.registry.tunnel(id);

  if (request.method !== "GET" || !entry) {
    return unexpected("media.direct.unknown", request.registry.releasedTunnelKey(id));
  }

  return serveTunnel(request, entry, "media.direct");
};

export const fakeCobalt = (request: FakeRequest): FakeResult => {
  if (request.method === "POST" && request.url.pathname === "/") return resolve(request);

  if (request.method === "GET" && request.url.pathname === "/tunnel") return tunnel(request);

  return unexpected("cobalt.unknown_route");
};
