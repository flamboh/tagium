import { describe, expect, it } from "vitest";
import { sha256 } from "../../scripts/conformance/bytes";
import {
  DEFAULT_CORPUS_SEED,
  generateCorpus,
  materializeFixture,
  stableManifestJson,
} from "../../scripts/conformance/fixture-generator";
import { runMutations } from "../../scripts/conformance/mutations";
import { audioPayloadSha256 } from "../../scripts/conformance/structural";

describe("metadata conformance corpus", () => {
  it("generates a stable 540-case manifest", () => {
    const first = stableManifestJson(generateCorpus(DEFAULT_CORPUS_SEED));
    const second = stableManifestJson(generateCorpus(DEFAULT_CORPUS_SEED));
    expect(first).toBe(second);
    expect(generateCorpus()).toHaveLength(540);
    expect(sha256(new TextEncoder().encode(first))).toMatch(/^[a-f0-9]{64}$/);
  });

  it("covers every required family and tag-store variant", () => {
    const variants = new Set(
      generateCorpus().map((fixture) => `${fixture.family}:${fixture.variant}`),
    );
    expect([...variants]).toEqual(
      expect.arrayContaining([
        "mp3:id3v1",
        "mp3:id3v2.2",
        "mp3:id3v2.3",
        "mp3:id3v2.4+apev2",
        "flac:comments",
        "flac:pictures",
        "flac:unknown-block",
        "m4a:aac-ilst",
        "m4a:alac-ilst",
        "m4a:freeform",
        "m4a:unknown-atom",
      ]),
    );
  });

  it("materializes identical bytes and independent essence hashes", () => {
    for (const fixtureCase of generateCorpus().filter(
      (fixture) => fixture.expected === "accepted",
    )) {
      const index = Number(fixtureCase.id.slice(-3));
      const first = materializeFixture(fixtureCase.family, index).bytes;
      const second = materializeFixture(fixtureCase.family, index).bytes;
      expect(first).toEqual(second);
      expect(sha256(first)).toBe(fixtureCase.fixtureSha256);
      expect(audioPayloadSha256(fixtureCase.family, first)).toBe(fixtureCase.audioPayloadSha256);
    }
  }, 15_000);

  it("makes mutation runs reproducible", () => {
    for (const family of ["mp3", "flac", "m4a"] as const) {
      expect(runMutations(family, 250)).toEqual(runMutations(family, 250));
    }
  });
});
