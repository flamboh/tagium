import { BotGuardClient, getChallenge } from "bgutils-js/botguard";
import { buildURL, getHeaders, USER_AGENT } from "bgutils-js/utils";
import { WebPoMinter } from "bgutils-js/webpo";
import { JSDOM } from "jsdom";
import { Constants, Innertube, Platform, Session, UniversalCache } from "youtubei.js";

import { parseAudioContext } from "./context.mjs";

const requestKey = "O43z0dpjhgX20SCx4KAo";

const sessionLifetimeMs = 15 * 60_000;

const mobileUserAgent =
  "Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1,gzip(gfe)";

let session;

let minter;

let dom;

export const resetAudioSession = async () => {
  const expired = minter;
  minter = undefined;
  session = undefined;
  await expired?.dispose();
};

const createMinter = async (fetch, signal) => {
  dom ??= new JSDOM("<!doctype html><html lang='en'><body></body></html>", {
    url: "https://www.youtube.com/",
    referrer: "https://www.youtube.com/",
    userAgent: USER_AGENT,
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin,
  });

  if (!Reflect.has(globalThis, "navigator")) {
    Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator });
  }

  const challenge = await getChallenge({ fetchFunction: fetch, requestKey });
  signal.throwIfAborted();
  const script = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;

  if (!script) throw new Error("YouTube attestation interpreter unavailable");
  new Function(script)();

  const botGuard = await BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObject: globalThis,
  });

  try {
    const webPoSignalOutput = [];
    const snapshot = await botGuard.snapshot({ webPoSignalOutput });
    signal.throwIfAborted();

    const response = await fetch(buildURL("GenerateIT", true), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify([requestKey, snapshot]),
    });

    if (!response.ok) throw new Error("YouTube integrity token request failed");
    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold] = await response.json();

    if (
      typeof integrityToken !== "string" ||
      !integrityToken ||
      !Number.isFinite(estimatedTtlSecs) ||
      estimatedTtlSecs <= 0
    ) {
      throw new Error("YouTube integrity token lifetime unavailable");
    }

    const refreshSeconds = Number.isFinite(mintRefreshThreshold)
      ? Math.max(0, mintRefreshThreshold)
      : 60;

    const lifetimeMs = Math.min(sessionLifetimeMs, (estimatedTtlSecs - refreshSeconds) * 1_000);

    if (lifetimeMs <= 0) throw new Error("YouTube integrity token already needs refresh");

    return {
      mint: await WebPoMinter.create({ integrityToken }, webPoSignalOutput),
      expiresAt: Date.now() + lifetimeMs,
      dispose: () => botGuard.shutdown().catch(() => {}),
    };
  } catch (error) {
    await botGuard.shutdown().catch(() => {});
    throw error;
  }
};

export const prepareAudio = async ({ videoId, fetch: transport, evaluate, signal }) => {
  Platform.shim.eval = evaluate;

  const fetch = async (input, init) => {
    signal.throwIfAborted();
    const response = await transport(input, init);

    if (response.status === 429) {
      await response.body?.cancel();
      const error = new Error("YouTube rate limit");
      error.code = "fetch.rate";
      throw error;
    }

    return response;
  };

  if (!session || Date.now() >= session.expiresAt) {
    await resetAudioSession();
    signal.throwIfAborted();

    const page = await fetch(`https://m.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      headers: { "user-agent": mobileUserAgent },
    });

    if (!page.ok) throw new Error("YouTube mobile session request failed");
    const { context, playerId, contentBound } = parseAudioContext(await page.text());
    Constants.CLIENTS.MWEB.VERSION = context.client.clientVersion;

    const yt = await Innertube.create({
      fetch,
      cache: new UniversalCache(false),
      enable_session_cache: false,
      generate_session_locally: true,
      retrieve_innertube_config: false,
      visitor_data: context.client.visitorData,
      user_agent: mobileUserAgent,
      player_id: playerId,
    });

    signal.throwIfAborted();
    yt.session.context = context;
    session = { yt, contentBound, expiresAt: Date.now() + sessionLifetimeMs };
  }

  if (!minter || Date.now() >= minter.expiresAt) {
    const expired = minter;
    minter = undefined;
    await expired?.dispose();
    signal.throwIfAborted();
    const generated = await createMinter(fetch, signal);

    if (signal.aborted) {
      await generated.dispose();
      signal.throwIfAborted();
    }

    minter = generated;
  }

  const cached = session.yt.session;
  const activeMinter = minter;
  const contentBound = session.contentBound;
  const playerToken = await activeMinter.mint.mintAsWebsafeString(videoId);

  const token = contentBound
    ? playerToken
    : await activeMinter.mint.mintAsWebsafeString(cached.context.client.visitorData);

  signal.throwIfAborted();

  const yt = new Innertube(
    new Session(
      structuredClone(cached.context),
      cached.api_key,
      cached.api_version,
      cached.account_index,
      cached.config_data,
      cached.player,
      undefined,
      fetch,
      cached.cache,
      playerToken,
    ),
  );

  return { yt, token };
};

export const withAudioToken = (url, token) => {
  const media = new URL(url);
  media.searchParams.set("pot", token);

  return media.toString();
};
