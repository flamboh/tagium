const cachedClient = { version: "", id: "" };

export const getSoundCloudClientId = async (fetch: typeof globalThis.fetch = globalThis.fetch) => {
  const html = await fetch("https://soundcloud.com/").then((response) => response.text());
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

  for (const script of html.matchAll(/<script.+src="(.+)">/g)) {
    const scriptUrl = script[1];
    if (!scriptUrl?.startsWith("https://a-v2.sndcdn.com/")) continue;
    const scriptText = await fetch(scriptUrl).then((response) => response.text());
    const scriptClientId = scriptText.match(/,client_id:"([A-Za-z0-9]{32})",/)?.[1];
    if (!scriptClientId) continue;
    cachedClient.version = version ?? "";
    cachedClient.id = scriptClientId;
    return scriptClientId;
  }

  throw new Error("soundcloud.client_id");
};
