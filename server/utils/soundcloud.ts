import {
  logSoundCloudFailure,
  type SoundCloudLogContext,
  type SoundCloudLogDetails,
} from "./soundcloud-observability";

const cachedClient = { version: "", id: "" };

const fetchText = async (
  input: string | URL,
  fetch: typeof globalThis.fetch,
  stage: string,
  context: SoundCloudLogContext,
) => {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(input);
  } catch (error) {
    await logSoundCloudFailure(
      stage,
      context,
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      startedAt,
    );
    throw error;
  }
  const contentType = response.headers.get("content-type") ?? undefined;
  if (!response.ok) {
    const details: SoundCloudLogDetails = { upstreamStatus: response.status };
    if (contentType) details.contentType = contentType;
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) details.retryAfter = retryAfter;
    await logSoundCloudFailure(stage, context, details, startedAt);
    throw new Error(`soundcloud.${stage}.http_${response.status}`);
  }
  try {
    return await response.text();
  } catch (error) {
    const details: SoundCloudLogDetails = {
      errorType: error instanceof Error ? error.name : "UnknownError",
    };
    if (contentType) details.contentType = contentType;
    await logSoundCloudFailure(stage.replace("_fetch", "_parse"), context, details, startedAt);
    throw error;
  }
};

export const getSoundCloudClientId = async (
  fetch: typeof globalThis.fetch = globalThis.fetch,
  context: SoundCloudLogContext = { requestId: crypto.randomUUID() },
) => {
  const html = await fetchText("https://soundcloud.com/", fetch, "client_id.home_fetch", context);
  const version = html
    .match(/<script>window\.__sc_version="[0-9]{10}"<\/script>/)?.[0]
    .match(/[0-9]{10}/)?.[0];
  if (version && cachedClient.version === version) return cachedClient.id;

  const hydratedClientId = html.match(
    /"hydratable"\s*:\s*"apiClient"\s*,\s*"data"\s*:\s*\{\s*"id"\s*:\s*"([^"]+)"/,
  )?.[1];
  if (hydratedClientId) {
    cachedClient.version = version ?? "";
    cachedClient.id = hydratedClientId;
    return hydratedClientId;
  }

  let foundSoundCloudScript = false;
  let lastScriptError: Error | undefined;
  for (const script of html.matchAll(/<script.+src="(.+)">/g)) {
    const scriptUrl = script[1];
    if (!scriptUrl?.startsWith("https://a-v2.sndcdn.com/")) continue;
    foundSoundCloudScript = true;
    let scriptText: string;
    try {
      scriptText = await fetchText(scriptUrl, fetch, "client_id.script_fetch", {
        ...context,
        url: scriptUrl,
      });
    } catch (error) {
      lastScriptError = error instanceof Error ? error : new Error("unknown script fetch failure");
      continue;
    }
    const scriptClientId = scriptText.match(/,client_id:"([A-Za-z0-9]{32})",/)?.[1];
    if (!scriptClientId) continue;
    cachedClient.version = version ?? "";
    cachedClient.id = scriptClientId;
    return scriptClientId;
  }

  await logSoundCloudFailure(
    foundSoundCloudScript ? "client_id.script_parse" : "client_id.home_parse",
    context,
  );
  throw new Error("soundcloud.client_id", lastScriptError ? { cause: lastScriptError } : undefined);
};
