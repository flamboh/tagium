import { readFileSync, writeFileSync } from "node:fs";

export const patchYouTube = (source) => {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) {
      throw new Error("Cobalt YouTube source changed; review the audio patch");
    }

    source = source.replace(before, after);
  };

  const replaceAll = (before, after, count) => {
    if (source.split(before).length !== count + 1) {
      throw new Error("Cobalt YouTube source changed; review the audio patch");
    }

    source = source.replaceAll(before, after);
  };

  replace(
    'import HLS from "hls-parser";',
    `import HLS from "hls-parser";
import { prepareAudio, resetAudioSession, withAudioToken } from "../../../cobalt-youtube/audio.mjs";
import { createYouTubeResolver } from "../../../cobalt-youtube/scheduler.mjs";
import { getHeaders } from "../../stream/shared.js";`,
  );
  replace("export default async function (o) {", "async function resolveYouTube(o) {");
  replace(
    'let innertubeClient = o.innertubeClient || env.customInnertubeClient || "IOS";',
    'let innertubeClient = o.isAudioOnly ? "MWEB" : o.innertubeClient || env.customInnertubeClient || "IOS";',
  );
  replace("let useHLS = o.youtubeHLS;", "let useHLS = !o.isAudioOnly && o.youtubeHLS;");
  replace("env.ytSessionServer && (", "!o.isAudioOnly && env.ytSessionServer && (");
  replace(
    "    let yt;\n    try {",
    `    let yt;
    if (o.isAudioOnly && o.id) {
        if (o.requestIP) throw new Error("The audio token session requires fixed egress");
        o.audioSession = await prepareAudio({
            videoId: o.id,
            evaluate: Platform.shim.eval,
            signal: o.signal,
            fetch: (input, init) => globalThis.fetch(input, {
                ...init,
                dispatcher: o.dispatcher,
            }),
        });
    }
    try {`,
  );
  replace("yt = await cloneInnertube(", "yt = o.audioSession?.yt ?? await cloneInnertube(");
  replace("if (env.ytUseOnesie) {", "if (!o.audioSession && env.ytUseOnesie) {");
  replace(
    "const checkFormat = (format, pCodec) => format.content_length &&",
    "const checkFormat = (format, pCodec) => (!o.audioSession || format.url || format.signature_cipher || format.cipher) && format.content_length &&",
  );
  replace(
    "if (!clientsWithNoCipher.includes(innertubeClient) && innertube) {\n            urls = await audio.decipher(innertube.session.player);\n        }",
    `if (!clientsWithNoCipher.includes(innertubeClient)) {
            urls = await audio.decipher(yt.session.player);
        }
        if (o.audioSession) {
            urls = withAudioToken(urls, o.audioSession.token);
            const probe = await fetch(urls, {
                method: "HEAD",
                headers: getHeaders("youtube"),
                dispatcher: o.dispatcher,
            });
            if (probe.status === 403 || probe.status === 429) {
                console.warn(JSON.stringify({ event: "youtube_audio_media_rejected", status: probe.status }));
                await resetAudioSession();
                return { error: probe.status === 429 ? "fetch.rate" : "fetch.fail", cooldown: probe.status === 403 ? "video" : undefined };
            }
            const size = Number(probe.headers.get("content-length"));
            if (probe.status !== 200 || !Number.isFinite(size) || size <= 0) {
                return { error: "fetch.fail" };
            }
        }`,
  );
  replace(
    "        dispatcher: undefined,\n        itag,",
    "        dispatcher: undefined,\n        signal: undefined,\n        audioSession: undefined,\n        itag,",
  );
  replaceAll(
    "requestIP: innertubeRequestIp,",
    "requestIP: o.audioSession ? o.requestIP : innertubeRequestIp,",
    2,
  );
  replaceAll(
    "            originalRequest,",
    "            originalRequest: o.audioSession ? undefined : originalRequest,",
    2,
  );
  replaceAll(
    "    } catch (e) {",
    "    } catch (e) {\n        if (e?.code === 'fetch.rate') return { error: 'fetch.rate' };",
    2,
  );
  replaceAll("dispatcher: o.dispatcher", "dispatcher: o.dispatcher, signal: o.signal", 4);
  replaceAll(
    'return { error: "youtube.login", retry: true }',
    'if (o.audioSession) await resetAudioSession();\n                return { error: "youtube.login" };',
    2,
  );
  source += "\nexport default createYouTubeResolver(resolveYouTube);\n";

  return source;
};

if (process.argv[1]?.endsWith("cobalt-patch-youtube.mjs")) {
  const path = process.argv[2];
  writeFileSync(path, patchYouTube(readFileSync(path, "utf8")));
}
