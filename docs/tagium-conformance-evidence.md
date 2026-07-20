# Tagium conformance acceptance evidence

This document maps the release criteria to reproducible evidence from the implementation completed
on 2026-07-20. The generated reports are the source of truth for measured values.

| Acceptance criterion                                                 | Evidence                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Byte-selected, format-independent browser engine                     | `src/features/audio/metadataEngine/engine.ts`, `detect.ts`, `driver.ts`, and `byteSource.ts`; unit tests under `tests/unit/features/audio/metadataEngine/`                                                                                                         |
| MP3 ID3v1 and ID3v2.2/2.3/2.4 with APEv2 coexistence                 | `mp3/mp3Driver.ts`; 180 MP3 corpus cases, golden projection/no-op/edit/hash assertions, and focused driver tests                                                                                                                                                   |
| FLAC comments, pictures, and unknown blocks                          | `flac/index.ts`; 180 FLAC corpus cases and focused unknown-block, multi-picture, bounded-read, and round-trip tests                                                                                                                                                |
| AAC/ALAC M4A/MP4 metadata, artwork, unknown atoms, and offsets       | `mp4/mp4.ts`; 180 MP4-family corpus cases and focused AAC/ALAC, `stco`/`co64`, multi-`mdat`, unknown-atom, artwork, fragmentation, and external-reference tests                                                                                                    |
| No transcoding and ordered audio essence unchanged                   | Independent structural hashes pass for every one of the 486 accepted corpus cases after a real edit; Playwright also compares downloaded essence hashes in Chromium, Firefox, and WebKit                                                                           |
| No-op byte equality and opaque metadata preservation                 | 486/486 byte-identical no-op assertions; per-family opaque marker and additional-artwork assertions in the generated conformance report                                                                                                                            |
| Editable projection and source filename/extension behavior           | Canonical model and driver tests; E2E import/edit/export for `.mp3`, `.flac`, `.m4a`, and `.mp4`; track totals are projected and retained even though only track number is edited in the UI                                                                        |
| Bounded reads, Blob-slice output, and controlled import concurrency  | Instrumented byte-source/unit tests reject reads over 8 MiB; production import concurrency is three; benchmark reports a 32,768-byte largest read                                                                                                                  |
| Performance gates                                                    | `docs/generated/metadata-benchmark.json`: 11.23x large scan throughput, 99.85% deterministic peak-allocation reduction, 4.31% better small-file median wall throughput, 96.86% less small-file copied work, and 0.79 ms scheduling p95; every asserted gate passed |
| Determinism, hostile inputs, typed failures, and source immutability | One-million seeded production mutation cases complete with zero crashes; corrupt/unsupported driver tests; repeated-download equality in all three Playwright engines                                                                                              |
| Independent validation                                               | ffprobe/FFmpeg 8.1.1, Mutagen 1.47.0, and TagLib 2.3 read both source and patched oracle samples and verify edited titles; FFmpeg decodes patched decoder-valid MP3, FLAC, AAC, and ALAC samples; exact counts are retained in the generated report                |
| Existing workflow compatibility                                      | Full repository suite: 68 test files and 420 tests; production build; upload hints, settings copy, local import, album/library operations, buffered editor changes, cover art, Cobalt post-tagging, and export integration                                         |
| Documentation and extension path                                     | `metadata-engine.md`, `metadata-format-research.md`, `metadata-conformance.md`, and `metadata-benchmark.md`                                                                                                                                                        |

## Verification record

- `bun run typecheck`: passed.
- `bun run lint`: passed with zero warnings and errors.
- `bun run test`: 68 files and 420 tests passed.
- `bun run build`: passed.
- `bun run conformance:extended`: 38 assertions/oracles passed, zero failed or skipped;
  540 fixtures and exactly 1,000,000 mutations.
- `bun run benchmark:metadata`: every performance/resource gate passed.
- `CI=1 bun run test:e2e -- tests/e2e/metadata-formats.spec.ts`: six tests passed across
  Chromium, Firefox, and WebKit.

## Exact limitations and safe exceptions

The synthetic corpus is intentionally small and redistributable. ffprobe recognizes eight of nine
structural samples; Mutagen and TagLib recognize all nine and confirm all nine edited titles. Those
counts remain visible rather than promoted to universal codec-decoder conformance. A separate pinned
FFmpeg stage generates and decodes all four supported codec/container combinations after patching.
Cross-browser flows supply separate runtime evidence.

Fragmented, encrypted, externally referenced, or ambiguous multi-audio-track MP4 layouts are rejected
without output. ID3 owned frames using unsupported per-frame compression, encryption, grouping,
data-length indication, or unsynchronisation are likewise rejected. On a real MP3 edit, an existing
extended-header CRC/restriction payload is replaced with a valid minimal extended header because the
old value describes the pre-edit tag. MP4 atom sizes and chunk offsets are structurally updated when
`moov` growth moves media; independent ordered media payload hashes remain unchanged.

The deterministic allocation counter is the primary memory gate because Bun process heap sampling is
not a reliable browser peak measure. Memory-backed small-corpus wall scans complete around one
millisecond and vary materially between identical runs, so deterministic copied work is the primary
small-file gate; all five wall samples and the best-effort ratio remain reported. A real browser
interaction trace is separately enforced in Playwright at p95 below 50 ms.
