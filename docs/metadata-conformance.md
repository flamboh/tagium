# Metadata conformance evaluator

Tagium's conformance evaluator is an independent, deterministic input generator and report runner for the browser metadata engine. It does not use the production parser to build fixtures or to identify encoded audio essence.

## Commands

Run the default PR-sized suite:

```sh
bun run conformance
```

The package-level alias points to `scripts/conformance/index.ts`; the evaluator can also be invoked
directly from a detached worktree.

Run without optional system oracles:

```sh
bun run scripts/conformance/index.ts --no-oracles
```

Run the documented one-million-case mutation suite:

```sh
bun run conformance:extended
```

Run the generator's focused regression tests:

```sh
bun run test -- tests/conformance/generator.test.ts
```

## Outputs

Every run replaces these deterministic-content artifacts (the timestamp in reports records the run):

- `docs/generated/metadata-corpus-manifest.json`: 540 case descriptors and golden canonical projections; fixture binaries are generated in memory and are not checked in.
- `docs/generated/metadata-conformance.json`: machine-readable assertions, mutation counts/digests, and oracle statuses.
- `docs/generated/metadata-conformance.md`: readable compatibility summary.

The CLI also writes the compact JSON report to stdout and exits non-zero when an assertion or available oracle fails. Missing optional oracles are explicitly `skipped`.

## Corpus

The fixed corpus contains 180 cases per family (540 total), including 54 adversarial cases. Variants cover:

- MP3 with no tags, ID3v1, ID3v2.2, ID3v2.3, ID3v2.4, coexisting APEv2 and ID3v1, unknown/private frames, padding, duplicate frames, all ID3 text encodings, multiple pictures, and large artwork.
- FLAC STREAMINFO, missing comments, Vorbis comments with duplicate values and ReplayGain, pictures including large artwork, padding, and opaque unknown metadata blocks.
- M4A with AAC and ALAC sample entries, iTunes `ilst`, freeform `----` metadata, duplicate items, artwork including a large entry, unknown atoms, free space, and multiple `mdat` regions.
- ASCII, Latin text, Unicode, emoji, RTL text, long values, truncation, invalid sizes/types, and content renamed from another format.

Each descriptor includes a fixture SHA-256, an independently derived ordered audio-payload SHA-256 for accepted cases, expected acceptance, feature labels, and golden editable metadata. Seeds and generation rules are stable; no current time, locale, platform randomness, copyrighted media, or network input affects fixture bytes.

## Assertions and preservation gates

The structural oracle hashes:

- MP3 bytes after ID3v2 and before APEv2/ID3v1;
- FLAC bytes after the final metadata block;
- concatenated top-level `mdat` payloads in file order for M4A, including multiple media-data regions.

Every accepted fixture is passed to the production drivers. The evaluator checks inspection against
golden canonical metadata, byte-for-byte identical no-op patches, and real edits that preserve the
independently derived structural audio hash, format-specific opaque markers, and unrelated artwork
counts. The structural implementation lives in `scripts/conformance/structural.ts`, separate from
production code.

The default mutation run performs 10,000 seeded mutations for each required family (30,000 total).
`--extended` performs exactly 1,000,000 total mutations. Mutations include bit flips, truncation,
zero/`0xff` replacement, and size poisoning. Every mutation runs byte detection and, when accepted,
production inspection, patching, reinspection, independent essence hashing, original-input
immutability checks, and the 8 MiB read cap. Defects, hangs, hash changes, or corrupt accepted output
fail the run; accepted/rejected counts and a digest make the result reproducible.

## External oracles

The runner discovers tools on `PATH`, verifies pinned versions, and records exact availability:

- ffprobe/FFmpeg 8.1.1 reads the synthetic samples and decodes Tagium-patched, decoder-valid MP3,
  FLAC, AAC, and ALAC samples generated deterministically in a temporary directory.
- Python Mutagen 1.47.0 runs when the `mutagen` module is installed.
- TagLib 2.3 is compiled into a temporary readback helper through `taglib-config` when available.

Each oracle reads both source and Tagium-patched outputs. ffprobe additionally confirms the edited
title on every synthetic output it recognizes. An installed oracle with the wrong version, or one
that recognizes none of the selected fixtures, fails the run. A missing executable/module is
reported as skipped with an actionable reason. The pins are constants in
`scripts/conformance/oracles.ts`; the repository does not download or install tools during
conformance execution. For release evidence, run in the pinned CI image containing all three tools
and retain the JSON report.

## Limits

Synthetic corpus payloads are deliberately tiny and target metadata/container structure. A separate
oracle stage uses pinned FFmpeg to generate decoder-valid MP3, FLAC, AAC, and ALAC samples, patches
them with the production drivers, and decodes every output. Cross-browser import/edit/export remains
separate evidence for browser behavior. Production limits (8 MiB maximum individual metadata read,
bounded atom/block counts, nesting, and materialization limits) are exercised by driver unit and
browser integration tests rather than bypassed here.
