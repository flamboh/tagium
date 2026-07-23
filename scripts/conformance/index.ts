#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { sha256 } from "./bytes";
import {
  DEFAULT_CORPUS_SEED,
  generateCorpus,
  materializeFixture,
  stableManifestJson,
} from "./fixture-generator";
import { DEFAULT_MUTATIONS_PER_FAMILY, EXTENDED_TOTAL_MUTATIONS, runMutations } from "./mutations";
import { runExternalOracles } from "./oracles";
import { runProductionChecks } from "./production-checks";
import { renderMarkdown } from "./report";
import { audioPayloadSha256 } from "./structural";
import type { AssertionResult, ConformanceReport } from "./types";

const args = new Set(process.argv.slice(2));
const extended = args.has("--extended");
const noOracles = args.has("--no-oracles");
const outputDirectory = resolve("docs/generated");
const seed = DEFAULT_CORPUS_SEED;
const corpus = generateCorpus(seed);
const manifest = stableManifestJson(corpus);
const assertions: AssertionResult[] = [];

assertions.push({
  name: "corpus contains at least 500 cases",
  status: corpus.length >= 500 ? "passed" : "failed",
  detail: `${corpus.length} cases`,
});
for (const family of ["mp3", "flac", "m4a"] as const) {
  const count = corpus.filter((fixture) => fixture.family === family).length;
  assertions.push({
    name: `${family}: format family represented`,
    status: count >= 150 ? "passed" : "failed",
    detail: `${count} cases`,
  });
}
const requiredFeatures = [
  "duplicates",
  "multiple-artwork",
  "large-artwork",
  "long-text",
  "unicode",
  "mislabeled",
  "malformed-or-truncated",
];
for (const feature of requiredFeatures) {
  const count = corpus.filter((fixture) => fixture.features.includes(feature)).length;
  assertions.push({
    name: `corpus feature: ${feature}`,
    status: count > 0 ? "passed" : "failed",
    detail: `${count} cases`,
  });
}
assertions.push({
  name: "manifest generation is deterministic",
  status: stableManifestJson(generateCorpus(seed)) === manifest ? "passed" : "failed",
});

let hashFailures = 0;
let adversarialAccepted = 0;
for (const fixtureCase of corpus) {
  const index = Number(fixtureCase.id.slice(-3));
  const fixture = materializeFixture(fixtureCase.family, index);
  if (fixtureCase.expected === "accepted") {
    try {
      if (audioPayloadSha256(fixtureCase.family, fixture.bytes) !== fixtureCase.audioPayloadSha256)
        hashFailures++;
    } catch {
      hashFailures++;
    }
  } else {
    try {
      audioPayloadSha256(fixtureCase.family, fixture.bytes);
      adversarialAccepted++;
    } catch {
      // Rejection is the expected result.
    }
  }
}
assertions.push({
  name: "independent structural audio-payload hashes reproduce",
  status: hashFailures === 0 ? "passed" : "failed",
  detail: `${hashFailures} mismatches`,
});
assertions.push({
  name: "adversarial fixtures are structurally rejected",
  status: adversarialAccepted === 0 ? "passed" : "failed",
  detail: `${adversarialAccepted} unexpectedly accepted`,
});
assertions.push(...(await runProductionChecks()));

const mutationsPerFamily = extended
  ? Math.floor(EXTENDED_TOTAL_MUTATIONS / 3)
  : DEFAULT_MUTATIONS_PER_FAMILY;
const mutations = await Promise.all(
  (["mp3", "flac", "m4a"] as const).map((family, index) =>
    runMutations(family, mutationsPerFamily + (extended && index === 2 ? 1 : 0), seed),
  ),
);
for (const mutation of mutations)
  assertions.push({
    name: `${mutation.family}: mutation runner completed without harness crashes`,
    status:
      mutation.completed === mutation.requested && mutation.crashes === 0 ? "passed" : "failed",
    detail: `${mutation.completed}/${mutation.requested}, ${mutation.crashes} crashes`,
  });

const oracles = noOracles
  ? (["ffprobe", "mutagen", "taglib"] as const).map((oracle) => ({
      oracle,
      status: "skipped" as const,
      checkedCases: 0,
      detail: "disabled with --no-oracles",
    }))
  : await runExternalOracles();
const allStatuses = [
  ...assertions.map((result) => result.status),
  ...oracles.map((result) => result.status),
];
const report: ConformanceReport = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  seed,
  corpus: {
    cases: corpus.length,
    byFamily: { mp3: 180, flac: 180, m4a: 180 },
    accepted: corpus.filter((fixture) => fixture.expected === "accepted").length,
    adversarial: corpus.filter((fixture) => fixture.expected === "rejected").length,
    manifestDigest: sha256(new TextEncoder().encode(manifest)),
  },
  assertions,
  mutations,
  oracles,
  summary: {
    passed: allStatuses.filter((status) => status === "passed").length,
    failed: allStatuses.filter((status) => status === "failed").length,
    skipped: allStatuses.filter((status) => status === "skipped").length,
  },
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "metadata-corpus-manifest.json"), manifest),
  writeFile(
    resolve(outputDirectory, "metadata-conformance.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  ),
  writeFile(resolve(outputDirectory, "metadata-conformance.md"), renderMarkdown(report)),
]);

console.log(JSON.stringify(report));
if (report.summary.failed > 0) process.exitCode = 1;
