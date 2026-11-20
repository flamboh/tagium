export const EXTENSION_CHANNEL = "tagium-youtube-v1";

export const MAX_AUDIO_BYTES = 128 * 1024 * 1024;

export const CHUNK_BYTES = 192 * 1024;

export const JOB_TIMEOUT_MS = 10 * 60 * 1000;

export const isVideoId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);

export const isAppOrigin = (origin: string, development: boolean) =>
  origin === "https://tagium.app" || (development && origin === "http://localhost:5173");

export type ExtensionRequest =
  | { type: "ping"; id: string }
  | { type: "start"; id: string; videoId: string }
  | { type: "ack"; id: string; sequence: number }
  | { type: "cancel"; id: string };

export type ExtensionReply =
  | { type: "ready"; id: string }
  | { type: "chunk"; id: string; sequence: number; data: string }
  | {
      type: "complete";
      id: string;
      bytes: number;
      title: string;
      artist: string;
      mime: "audio/mp4" | "audio/webm";
    }
  | { type: "error"; id: string; message: string; canceled?: boolean };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isRequest = (value: unknown): value is ExtensionRequest => {
  if (!record(value) || typeof value.id !== "string" || !/^[a-f0-9-]{36}$/.test(value.id))
    return false;

  return (
    value.type === "ping" ||
    value.type === "cancel" ||
    (value.type === "start" && isVideoId(value.videoId)) ||
    (value.type === "ack" && Number.isSafeInteger(value.sequence) && Number(value.sequence) >= 0)
  );
};

export const isReply = (value: unknown): value is ExtensionReply => {
  if (!record(value) || typeof value.id !== "string") return false;

  switch (value.type) {
    case "ready":
      return true;
    case "error":
      return (
        typeof value.message === "string" &&
        value.message.length <= 500 &&
        (value.canceled === undefined || typeof value.canceled === "boolean")
      );
    case "chunk":
      return (
        Number.isSafeInteger(value.sequence) &&
        Number(value.sequence) >= 0 &&
        typeof value.data === "string" &&
        value.data.length <= (CHUNK_BYTES * 4) / 3 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(value.data)
      );
    case "complete":
      return (
        Number.isSafeInteger(value.bytes) &&
        Number(value.bytes) > 0 &&
        Number(value.bytes) <= MAX_AUDIO_BYTES &&
        typeof value.title === "string" &&
        value.title.length <= 500 &&
        typeof value.artist === "string" &&
        value.artist.length <= 500 &&
        (value.mime === "audio/mp4" || value.mime === "audio/webm")
      );
    default:
      return false;
  }
};
