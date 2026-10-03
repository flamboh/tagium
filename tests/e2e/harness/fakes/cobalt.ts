import { createHash, randomBytes } from "node:crypto";
import {
  FAKE_COBALT_API_KEY,
  FAKE_COBALT_MACHINE_ID,
  FAKE_COBALT_ORIGIN,
  mediaKeyFromUrl,
  type MediaScenario,
} from "../protocol.ts";
import { audioResponse, imageResponse, json, sleep } from "./assets.ts";
import { hangThenFail, unexpected, type FakeRequest, type FakeResult } from "./types.ts";

const sanitize = (value: string) =>
  value.replace(/[<>:"/\\|?*]/gu, (character) =>
    String.fromCodePoint(character.codePointAt(0)! + 0xfee0),
  );

const mimeTypes = { mp3: "audio/mpeg", m4a: "audio/mp4", opus: "audio/ogg" } as const;

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

const localProcessingPlan = (
  request: FakeRequest,
  scenario: MediaScenario,
  requested: { audioFormat?: string; audioBitrate?: string },
) => {
  const best = requested.audioFormat === "best";
  const format =
    scenario.service === "youtube"
      ? best
        ? "m4a"
        : "mp3"
      : best && scenario.audio !== "mp3"
        ? "opus"
        : "mp3";
  const type = scenario.service === "youtube" && best ? "proxy" : "audio";
  const tunnels = [
    tunnelUrl(
      request.registry.createTunnel({
        key: scenario.key,
        part: "audio",
        machineId: FAKE_COBALT_MACHINE_ID,
      }),
    ),
  ];
  if (scenario.cover) {
    tunnels.push(
      tunnelUrl(
        request.registry.createTunnel({
          key: scenario.key,
          part: "cover",
          machineId: FAKE_COBALT_MACHINE_ID,
        }),
      ),
    );
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
      type: mimeTypes[format],
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
  let body: { url?: string; audioFormat?: string; audioBitrate?: string };
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
    case "hang":
      return respond(hangThenFail(request.registry, key));
    case "invalid-machine-id":
    case "ok": {
      const scenario = request.registry.media(key);
      if (!scenario) return unexpected("cobalt.resolve.no_media", key);
      const plan = localProcessingPlan(request, scenario, body);
      const headers = {
        "x-cobalt-machine-id": behavior.kind === "ok" ? FAKE_COBALT_MACHINE_ID : "Invalid Machine!",
      };
      const delayMs = behavior.kind === "ok" ? (behavior.delayMs ?? 0) : 0;
      return respond(sleep(delayMs).then(() => json(plan, { headers })));
    }
  }
};

const tunnel = (request: FakeRequest): FakeResult => {
  const entry = request.registry.tunnel(request.url.searchParams.get("id"));
  if (!entry) return unexpected("cobalt.tunnel.unknown");
  if (request.headers.get("fly-force-instance-id") !== entry.machineId) {
    return unexpected("cobalt.tunnel.machine_mismatch", entry.key);
  }
  const scenario = request.registry.media(entry.key);
  if (!scenario) return unexpected("cobalt.tunnel.no_media", entry.key);
  const respond = (response: Response | Promise<Response>): FakeResult => ({
    route: `cobalt.tunnel.${entry.part}`,
    key: entry.key,
    response,
  });
  if (entry.part === "cover") {
    return scenario.cover
      ? respond(imageResponse(scenario.cover))
      : unexpected("cobalt.tunnel.cover", entry.key);
  }

  const behavior = request.registry.nextTunnel(entry.key) ?? { kind: "ok" };
  switch (behavior.kind) {
    case "ok":
      return respond(sleep(behavior.delayMs ?? 0).then(() => audioResponse(scenario.audio)));
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
    case "hang":
      return respond(hangThenFail(request.registry, entry.key));
  }
};

export const fakeCobalt = (request: FakeRequest): FakeResult => {
  if (request.method === "POST" && request.url.pathname === "/") return resolve(request);
  if (request.method === "GET" && request.url.pathname === "/tunnel") return tunnel(request);
  return unexpected("cobalt.unknown_route");
};
