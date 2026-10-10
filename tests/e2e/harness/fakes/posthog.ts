import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { Buffer } from "node:buffer";
import { json } from "./assets.ts";
import { unexpected, type FakeRequest, type FakeResult } from "./types.ts";

const CAPTURE_PATHS = new Set(["/e/", "/i/v0/e/", "/batch/", "/capture/", "/track/"]);
const FLAGS_PATHS = new Set(["/flags/", "/decide/"]);
const staticDir = fileURLToPath(
  new URL("../../../../node_modules/posthog-js/dist/", import.meta.url),
);

const decodeBody = (request: FakeRequest) => {
  const bytes = request.bodyBytes ?? new Uint8Array();
  if (bytes.byteLength === 0) return "[]";
  const compression = request.url.searchParams.get("compression");
  if (compression === "gzip-js" || (bytes[0] === 0x1f && bytes[1] === 0x8b)) {
    return gunzipSync(bytes).toString("utf8");
  }
  const text = Buffer.from(bytes).toString("utf8");
  if (compression === "base64" || text.startsWith("data=")) {
    const data = new URLSearchParams(text).get("data") ?? "";
    return Buffer.from(data, "base64").toString("utf8");
  }
  return text;
};

export const fakePostHog = (request: FakeRequest): FakeResult => {
  const path = request.url.pathname;
  if (CAPTURE_PATHS.has(path)) {
    const decoded = decodeBody(request);
    return {
      route: "posthog.capture",
      key: null,
      body: decoded,
      response: json({ status: 1 }),
    };
  }
  if (FLAGS_PATHS.has(path)) {
    return {
      route: "posthog.flags",
      key: null,
      response: json({
        featureFlags: {},
        featureFlagPayloads: {},
        errorsWhileComputingFlags: false,
        sessionRecording: false,
        supportedCompression: ["gzip", "gzip-js"],
      }),
    };
  }
  if (/^\/array\/[^/]+\/config$/u.test(path)) {
    return { route: "posthog.config", key: null, response: json({}) };
  }
  if (/^\/array\/[^/]+\/config\.js$/u.test(path)) {
    return {
      route: "posthog.config",
      key: null,
      response: new Response("", { headers: { "content-type": "application/javascript" } }),
    };
  }
  if (path.startsWith("/static/")) {
    const file = `${staticDir}${basename(path)}`;
    return {
      route: "posthog.static",
      key: null,
      response: existsSync(file)
        ? new Response(readFileSync(file), {
            headers: { "content-type": "application/javascript" },
          })
        : new Response("not found", { status: 404 }),
    };
  }
  return unexpected("posthog.unknown_route");
};
