export const parseAudioContext = (html) => {
  const config = {};

  for (const match of html.matchAll(/ytcfg\.set\(\s*({.+?})\s*\);/gs)) {
    Object.assign(config, JSON.parse(match[1]));
  }

  const context = config.INNERTUBE_CONTEXT;
  const client = context?.client;
  const playerId = config.PLAYER_JS_URL?.match(/\/s\/player\/([a-zA-Z0-9_-]+)\//)?.[1];

  if (
    client?.clientName !== "MWEB" ||
    typeof client.clientVersion !== "string" ||
    typeof client.visitorData !== "string" ||
    !client.visitorData ||
    !playerId
  ) {
    throw new Error("YouTube mobile session configuration unavailable");
  }

  const contentBound = Object.values(config.WEB_PLAYER_CONTEXT_CONFIGS ?? {}).some(
    (player) =>
      new URLSearchParams(player.serializedExperimentFlags)
        .getAll("html5_generate_content_po_token")
        .at(-1) === "true",
  );

  return { context, playerId, contentBound };
};
