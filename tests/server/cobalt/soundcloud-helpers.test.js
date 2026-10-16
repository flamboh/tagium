import { describe, expect, it } from "vite-plus/test";
import {
  buildSoundCloudFailureCode,
  isSoundCloudResolvePayload,
  unplayableSoundCloudError,
} from "../../../cobalt-soundcloud-helpers.mjs";

describe("Cobalt SoundCloud adapter helpers", () => {
  it("rejects malformed resolve payloads", () => {
    expect(isSoundCloudResolvePayload(null)).toBe(false);
    expect(isSoundCloudResolvePayload([])).toBe(false);
    expect(isSoundCloudResolvePayload({ media: null })).toBe(true);
  });

  it("buckets and validates diagnostics in failure codes", () => {
    expect(
      buildSoundCloudFailureCode("resolve_fetch", {
        upstreamStatus: 429,
        contentType: "application/json; secret=leak",
        retryAfter: "not safe",
        errorType: "UnexpectedSecretError",
      }),
    ).toBe("fetch.soundcloud.resolve_fetch.429.errorType-OtherError");
    expect(
      buildSoundCloudFailureCode("resolve_fetch", {
        contentType: "application/json",
        retryAfter: "30",
        errorType: "TypeError",
      }),
    ).toBe(
      "fetch.soundcloud.resolve_fetch.contentType-application/json.retryAfter-30.errorType-TypeError",
    );
  });

  it("reports drm only when every stream is encrypted", () => {
    const stream = (protocol) => ({ preset: "aac_160k", format: { protocol } });

    expect(
      unplayableSoundCloudError([stream("ctr-encrypted-hls"), stream("cbc-encrypted-hls")]),
    ).toBe("soundcloud.maybe_drm");
    expect(unplayableSoundCloudError([stream("ctr-encrypted-hls"), stream("hls")])).toBe(
      "soundcloud.no_stream",
    );
    expect(unplayableSoundCloudError([])).toBe("soundcloud.no_stream");
  });
});
