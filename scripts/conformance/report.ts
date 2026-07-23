import type { ConformanceReport } from "./types";

const escapeCell = (value: string | number | undefined) =>
  String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");

export const renderMarkdown = (report: ConformanceReport) => `# Tagium metadata conformance report

Generated: ${report.generatedAt}<br>
Seed: \`${report.seed}\`<br>
Manifest digest: \`${report.corpus.manifestDigest}\`

## Summary

| Passed | Failed | Skipped | Corpus cases | Adversarial cases |
| ---: | ---: | ---: | ---: | ---: |
| ${report.summary.passed} | ${report.summary.failed} | ${report.summary.skipped} | ${report.corpus.cases} | ${report.corpus.adversarial} |

Family counts: MP3 ${report.corpus.byFamily.mp3}, FLAC ${report.corpus.byFamily.flac}, M4A ${report.corpus.byFamily.m4a}.

## Assertions

| Status | Assertion | Detail |
| --- | --- | --- |
${report.assertions.map((result) => `| ${result.status} | ${escapeCell(result.name)} | ${escapeCell(result.detail)} |`).join("\n")}

## Seeded mutation testing

| Family | Completed | Accepted | Rejected | Crashes | Digest |
| --- | ---: | ---: | ---: | ---: | --- |
${report.mutations.map((result) => `| ${result.family} | ${result.completed} | ${result.accepted} | ${result.rejected} | ${result.crashes} | \`${result.digest}\` |`).join("\n")}

## Independent external oracles

| Oracle | Status | Version | Cases | Detail |
| --- | --- | --- | ---: | --- |
${report.oracles.map((result) => `| ${result.oracle} | ${result.status} | ${escapeCell(result.version)} | ${result.checkedCases} | ${escapeCell(result.detail)} |`).join("\n")}

Oracle availability is explicit: missing optional executables are reported as skipped, never silently treated as passing. The structural corpus deliberately uses tiny encoded payloads; the FFmpeg oracle separately generates and decodes patched decoder-valid MP3, FLAC, AAC, and ALAC samples.
`;
