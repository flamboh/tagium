import process from "node:process";
import type { AudioFixtureName, ImageFixtureName } from "../fixtures/catalog.ts";

export const E2E_PORT = Number(process.env.E2E_PORT ?? 4317);
export const E2E_CONTROL_PORT = Number(process.env.E2E_CONTROL_PORT ?? E2E_PORT + 1);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const E2E_CONTROL_URL = `http://127.0.0.1:${E2E_CONTROL_PORT}`;

export const FAKE_COBALT_ORIGIN = "http://cobalt.e2e.test";
export const FAKE_COBALT_API_KEY = "e2e-cobalt-api-key";
export const FAKE_COBALT_MACHINE_ID = "e2e-machine-1";
export const FAKE_SOUNDCLOUD_CLIENT_ID = "e2eSoundCloudClientId00000000000";

export type Sequence<T> = T | readonly T[];

export type CobaltBehavior =
  | { kind: "ok"; delayMs?: number }
  | { kind: "error"; code: string; status?: number }
  | { kind: "capacity"; retryAfter?: string }
  | { kind: "non-json"; status?: number }
  | { kind: "invalid-machine-id" }
  | { kind: "hang" };

export type TunnelBehavior =
  | { kind: "ok"; delayMs?: number }
  | { kind: "empty" }
  | { kind: "capacity"; retryAfter?: string }
  | { kind: "status"; status: number; body?: string }
  | { kind: "hang" };

export type MetadataBehavior = { kind: "ok" } | { kind: "status"; status: number };

export type MediaScenario = {
  type: "media";
  key: string;
  service: "youtube" | "soundcloud";
  sourceUrl: string;
  title: string;
  author: string;
  durationSec: number;
  audio: AudioFixtureName;
  cover: ImageFixtureName | null;
  year?: number;
  genre?: string;
  album?: string;
  soundcloudId?: number;
  metadata: MetadataBehavior;
  cobalt: Sequence<CobaltBehavior>;
  tunnel: Sequence<TunnelBehavior>;
};

export type YouTubePlaylistScenario = {
  type: "youtube-playlist";
  key: string;
  playlistId: string;
  title: string;
  author: string;
  videoKeys: string[];
  pageSize: number;
  status?: number;
};

export type SoundCloudSetScenario = {
  type: "soundcloud-set";
  key: string;
  sourceUrl: string;
  title: string;
  author: string;
  genre: string;
  displayDate?: string;
  releaseDate?: string;
  isAlbum: boolean;
  artwork: ImageFixtureName | null;
  tracks: { key: string; stub: boolean }[];
  status?: number;
};

export type ShortLinkScenario = {
  type: "short-link";
  key: string;
  location: string;
};

export type Scenario =
  | MediaScenario
  | YouTubePlaylistScenario
  | SoundCloudSetScenario
  | ShortLinkScenario;

export type RateLimitRule = {
  binding: string;
  key: string;
  limit: number | "unavailable";
};

export type UpstreamCall = {
  at: number;
  origin: "worker" | "browser";
  method: string;
  url: string;
  host: string;
  route: string;
  key: string | null;
  owner: string | null;
  status: number;
  unexpected: boolean;
  requestHeaders: Record<string, string>;
  requestBody?: string;
};

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);
const soundcloudHosts = new Set(["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"]);

export const youtubeVideoKey = (id: string) => `yt:${id}`;
export const youtubePlaylistKey = (id: string) => `ytpl:${id}`;
export const soundcloudKey = (pathname: string) =>
  `sc:${pathname.toLowerCase().replace(/\/+$/u, "")}`;
export const shortLinkKey = (url: URL) => `short:${url.hostname.toLowerCase()}${url.pathname}`;

export const mediaKeyFromUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") return youtubeVideoKey(url.pathname.split("/")[1] ?? "");
  if (youtubeHosts.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "playlist") return youtubePlaylistKey(url.searchParams.get("list") ?? "");
    const id = parts[0] === "watch" ? url.searchParams.get("v") : parts[1];
    return id ? youtubeVideoKey(id) : null;
  }
  if (soundcloudHosts.has(host)) return soundcloudKey(url.pathname);
  if (host === "on.soundcloud.com" || host === "snd.sc") return shortLinkKey(url);
  return null;
};
