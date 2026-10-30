import { Innertube, Log } from "youtubei.js/web";
import { CHUNK_BYTES, MAX_AUDIO_BYTES } from "../../../src/shared/youtube-extension/protocol";

Log.setLevel(Log.Level.NONE);

export const allowedYouTubeUrl = (input: string) => {
  const url = new URL(input);

  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;

  return (
    (url.hostname === "www.youtube.com" && url.pathname === "/youtubei/v1/player") ||
    (url.hostname.endsWith(".googlevideo.com") && url.pathname === "/videoplayback")
  );
};

export const acquireAudio = async (
  videoId: string,
  signal: AbortSignal,
  onChunk: (chunk: Uint8Array) => Promise<void>,
) => {
  const localFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);

    if (!allowedYouTubeUrl(request.url)) throw new Error("unsupported youtube request.");
    const headers = new Headers(request.headers);

    for (const name of [
      "cookie",
      "authorization",
      "x-goog-authuser",
      "x-origin",
      "origin",
      "user-agent",
    ])
      headers.delete(name);

    return fetch(
      new Request(request, {
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers,
        signal,
      }),
    );
  };

  const youtube = await Innertube.create({
    fetch: localFetch,
    retrieve_player: false,
    generate_session_locally: true,
    enable_session_cache: false,
    retrieve_innertube_config: false,
  });

  const info = await youtube.getBasicInfo(videoId, { client: "IOS" });

  if (info.playability_status?.status !== "OK") {
    throw new Error("youtube did not allow anonymous playback on this connection.");
  }

  if (info.basic_info.is_live || info.basic_info.is_post_live_dvr) {
    throw new Error("live audio is not supported by this prototype.");
  }

  const format = info.streaming_data?.adaptive_formats
    .filter(
      (item) =>
        item.has_audio &&
        !item.has_video &&
        item.url &&
        !item.cipher &&
        !item.signature_cipher &&
        !item.is_type_otf &&
        !item.drm_families?.length &&
        (item.mime_type.startsWith("audio/mp4") || item.mime_type.startsWith("audio/webm")) &&
        (!item.audio_track || item.audio_track.audio_is_default),
    )
    .sort((a, b) => b.bitrate - a.bitrate)[0];

  if (!format?.url || !format.content_length) {
    throw new Error(
      "youtube requires a token, deciphering, or segmented playback that this prototype does not support.",
    );
  }

  if (format.content_length > MAX_AUDIO_BYTES)
    throw new Error("audio exceeds the 128 mb prototype limit.");
  const mediaUrl = new URL(format.url);
  mediaUrl.searchParams.set("cpn", info.cpn);
  const response = await localFetch(mediaUrl);

  if (!response.ok || !response.body) {
    throw new Error(
      `youtube media request failed (${response.status}); token or connection restrictions may apply.`,
    );
  }

  const reader = response.body.getReader();
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;
      bytes += value.byteLength;

      if (bytes > MAX_AUDIO_BYTES || bytes > format.content_length)
        throw new Error("unexpected audio size.");

      for (let offset = 0; offset < value.length; offset += CHUNK_BYTES) {
        signal.throwIfAborted();
        await onChunk(value.slice(offset, offset + CHUNK_BYTES));
      }
    }
  } finally {
    await reader.cancel();
  }

  if (bytes !== format.content_length) throw new Error("youtube returned incomplete audio.");

  return {
    bytes,
    title: (info.basic_info.title ?? videoId).slice(0, 500),
    artist: (info.basic_info.author ?? "").slice(0, 500),
    mime: format.mime_type.startsWith("audio/mp4")
      ? ("audio/mp4" as const)
      : ("audio/webm" as const),
  };
};
