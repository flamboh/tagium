import { describe, expect, it } from "vite-plus/test";
import { parseAudioContext } from "../../cobalt-youtube/context.mjs";

const page = (flags) => `
<script>ytcfg.set(${JSON.stringify({
  INNERTUBE_CONTEXT: {
    client: { clientName: "MWEB", clientVersion: "2.20261022.04.00", visitorData: "visitor" },
  },
  WEB_PLAYER_CONTEXT_CONFIGS: { mobile: { serializedExperimentFlags: flags } },
})});</script>
<script>ytcfg.set({"PLAYER_JS_URL":"/s/player/current-player/player_es6.vflset/en_US/base.js"});</script>`;

describe("mobile YouTube session context", () => {
  it("uses the served client version and token-binding experiment across separate config blocks", () => {
    const result = parseAudioContext(page("html5_generate_content_po_token=true"));
    expect(result).toMatchObject({
      context: { client: { clientVersion: "2.20261022.04.00", visitorData: "visitor" } },
      playerId: "current-player",
      contentBound: true,
    });
    expect(parseAudioContext(page("")).contentBound).toBe(false);
  });

  it("rejects consent pages and incomplete client contexts instead of synthesizing a visitor", () => {
    expect(() => parseAudioContext("<html>consent required</html>")).toThrow("configuration");
    expect(() =>
      parseAudioContext(page("").replace('"visitorData":"visitor"', '"visitorData":""')),
    ).toThrow("configuration");
  });
});
