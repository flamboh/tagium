import { env } from "../../config.js";
import { resolveRedirectingURL } from "../url.js";

const cachedClient = { version: "", id: "" };

const failure = (stage, details = {}) => {
  const statusSuffix = details.upstreamStatus ? `.${details.upstreamStatus}` : "";
  return { error: `fetch.soundcloud.${stage}${statusSuffix}` };
};

const fetchText = async (url, stage) => {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    return failure(stage, {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  }
  const contentType = response.headers.get("content-type") ?? undefined;
  if (!response.ok) {
    return failure(stage, {
      upstreamStatus: response.status,
      ...(contentType ? { contentType } : {}),
      ...(response.headers.get("retry-after")
        ? { retryAfter: response.headers.get("retry-after") }
        : {}),
    });
  }
  try {
    return { value: await response.text() };
  } catch (error) {
    return failure(`${stage}_body`, {
      ...(contentType ? { contentType } : {}),
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  }
};

const fetchJson = async (url, stage) => {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    return failure(stage, {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  }
  const contentType = response.headers.get("content-type") ?? undefined;
  if (!response.ok) {
    return failure(stage, {
      upstreamStatus: response.status,
      ...(contentType ? { contentType } : {}),
      ...(response.headers.get("retry-after")
        ? { retryAfter: response.headers.get("retry-after") }
        : {}),
    });
  }
  try {
    return { value: await response.json() };
  } catch (error) {
    return failure(`${stage}_parse`, {
      ...(contentType ? { contentType } : {}),
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  }
};

const findClientId = async () => {
  const home = await fetchText("https://soundcloud.com/", "client_id.home_fetch");
  if (home.error) return home;

  const version = home.value
    .match(/<script>window\.__sc_version="[0-9]{10}"<\/script>/)?.[0]
    .match(/[0-9]{10}/)?.[0];
  if (version && cachedClient.version === version && cachedClient.id) {
    return { value: cachedClient.id };
  }

  let clientId = home.value.match(
    /"hydratable"\s*:\s*"apiClient"\s*,\s*"data"\s*:\s*\{\s*"id"\s*:\s*"([^"]+)"/,
  )?.[1];
  let foundScript = false;
  let lastScriptFailure;
  if (!clientId) {
    for (const script of home.value.matchAll(/<script.+src="(.+)">/g)) {
      const scriptUrl = script[1];
      if (!scriptUrl?.startsWith("https://a-v2.sndcdn.com/")) continue;
      foundScript = true;
      const scriptResponse = await fetchText(scriptUrl, "client_id.script_fetch");
      if (scriptResponse.error) {
        lastScriptFailure = scriptResponse;
        continue;
      }
      clientId = scriptResponse.value.match(/,client_id:"([A-Za-z0-9]{32})",/)?.[1];
      if (clientId) break;
    }
  }

  if (!clientId) {
    if (lastScriptFailure) return lastScriptFailure;
    return failure(foundScript ? "client_id.script_parse" : "client_id.home_parse");
  }
  cachedClient.version = version ?? "";
  cachedClient.id = clientId;
  return { value: clientId };
};

const findBestForPreset = (transcodings, preset) => {
  let inferior;
  for (const entry of transcodings) {
    const protocol = entry?.format?.protocol;
    if (entry.snipped || protocol?.includes("encrypted")) continue;
    if (entry?.preset?.startsWith(`${preset}_`)) {
      if (protocol === "progressive") return entry;
      inferior = entry;
    }
  }
  return inferior;
};

export default async function soundcloud(input) {
  const clientIdResult = await findClientId();
  if (clientIdResult.error) return clientIdResult;
  const clientId = clientIdResult.value;
  let obj = input;
  let link;

  if (obj.shortLink) {
    obj = {
      ...obj,
      ...(await resolveRedirectingURL(`https://on.soundcloud.com/${obj.shortLink}`)),
    };
  }
  if (obj.author && obj.song) {
    link = `https://soundcloud.com/${obj.author}/${obj.song}`;
    if (obj.accessKey) link += `/s-${obj.accessKey}`;
  }
  if (!link && obj.shortLink) return { error: "fetch.short_link" };
  if (!link) return { error: "link.unsupported" };

  const resolveUrl = new URL("https://api-v2.soundcloud.com/resolve");
  resolveUrl.searchParams.set("url", link);
  resolveUrl.searchParams.set("client_id", clientId);
  const resolveResult = await fetchJson(resolveUrl, "resolve_fetch");
  if (resolveResult.error) return resolveResult;
  const json = resolveResult.value;

  if (json.duration > env.durationLimit * 1000) return { error: "content.too_long" };
  if (json.policy === "BLOCK") return { error: "content.region" };
  if (json.policy === "SNIP") return { error: "content.paid" };
  if (!json.media?.transcodings?.length) return { error: "fetch.empty" };

  let bestAudio = "opus";
  let selectedStream = findBestForPreset(json.media.transcodings, "opus");
  const mp3Media = findBestForPreset(json.media.transcodings, "mp3");
  if (mp3Media && (obj.format === "mp3" || !selectedStream)) {
    selectedStream = mp3Media;
    bestAudio = "mp3";
  }
  if (!selectedStream) return { error: "fetch.empty" };

  const streamUrl = new URL(selectedStream.url);
  streamUrl.searchParams.set("client_id", clientId);
  streamUrl.searchParams.set("track_authorization", json.track_authorization);
  const streamResult = await fetchJson(streamUrl, "stream_fetch");
  if (streamResult.error) return streamResult;
  let file;
  try {
    file = new URL(streamResult.value.url);
  } catch (error) {
    return failure("stream_parse", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  }

  const artist = json.user?.username?.trim();
  const fileMetadata = {
    title: json.title?.trim(),
    album: json.publisher_metadata?.album_title?.trim(),
    artist,
    album_artist: artist,
    composer: json.publisher_metadata?.writer_composer?.trim(),
    genre: json.genre?.trim(),
    date: json.display_date?.trim().slice(0, 10),
    copyright: json.license?.trim(),
  };
  let cover;
  if (json.artwork_url) {
    const coverUrl = json.artwork_url.replace(/-large/, "-t1080x1080");
    const hasCover = await fetch(coverUrl)
      .then((response) => response.status === 200)
      .catch(() => false);
    if (hasCover) cover = coverUrl;
  }

  return {
    urls: file.toString(),
    cover,
    filenameAttributes: { service: "soundcloud", id: json.id, ...fileMetadata },
    bestAudio,
    fileMetadata,
    isHLS: file.pathname.endsWith(".m3u8"),
  };
}
