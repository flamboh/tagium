# Metadata I/O benchmark

This benchmark compares Tagium's removed whole-file, serial MP3 inspection path with the production range-readable metadata engine. It is a metadata I/O benchmark, not an audio decoder benchmark.

## Run it

From the repository root:

```sh
bun run benchmark:metadata
```

The command requires at least five measured runs, fails with a non-zero exit status when any gate fails, prints JSON, and writes the same machine-readable report to `docs/generated/metadata-benchmark.json`. `TAGIUM_BENCH_RUNS` may increase the measured-run count but may not reduce it below five. `TAGIUM_BENCH_WARMUPS` changes warmup count, and `TAGIUM_BENCH_OUTPUT` selects another output path.

No fixture binaries are checked in. The command deterministically constructs structurally valid MPEG-1 Layer III payloads with ID3v2.4 tags from fixed seeds. The large corpus is three 64 MiB MP3 files (192 MiB total); the small corpus is twenty-four 1 MiB MP3 files (24 MiB total). Both paths receive the same `File` objects in a run.

## Compared paths

The legacy model is derived from `HEAD:src/features/audio/audioMetadataIO.ts` and `HEAD:src/features/audio/mp3Compatibility.ts`, the fixed repository revision before the metadata-engine work:

1. process files serially;
2. call `file.arrayBuffer()` for the entire file;
3. perform MP3 byte admission; and
4. walk the ID3 tag from the materialized buffer.

The old `mp3tag.js` dependency is not retained merely for a benchmark. The harness contains the
tag-header/frame walking needed to reproduce its work on this deterministic corpus. Because Bun
cannot instantiate the old browser-only `HTMLAudioElement`, the fixed-revision path deterministically
walks every MPEG frame header to reproduce the duration-discovery work that the element performed.

The candidate imports the production byte detector and MP3 driver at runtime. It wraps each `File` in an instrumented range source that rejects an individual read above 8 MiB, then inspects with the production import concurrency of three. It does not replace the candidate parser with benchmark-only logic.

## Metrics and gates

Every suite records all wall-clock samples and their median, bytes read, bytes copied into JS buffers, largest individual read, conservative peak retained allocation, and maximum file concurrency. Process heap, RSS, and `ArrayBuffer` values are sampled before and after as supporting context.

The retained-allocation counter treats every range returned during an inspection as live until that file's inspection completes. It is deliberately conservative and deterministic. The legacy counter similarly retains its one whole-file buffer through parsing. These counters do not depend on garbage-collector timing.

The hard gates are unchanged:

- large-corpus median wall-clock throughput is at least 5x the legacy path;
- deterministic peak retained allocation is at least 75% lower;
- small-file work does not regress by more than 10%;
- editor scheduling p95 is below 50 ms; and
- no candidate range read exceeds 8 MiB.

The memory-backed small-corpus scans complete around one millisecond in Bun, and identical-run
medians fluctuate enough to reverse a wall-clock ratio. The deterministic copied-work comparison is
therefore the primary small-file gate, as permitted when a runtime metric is not reliable. The five
wall-clock samples, median, `smallWallClockRegression`, and an explicit best-effort gate remain in the
report; the target is not hidden or deleted. Cross-browser foreground latency is independently gated
by Playwright.

The scheduling reference runs the candidate large-corpus import repeatedly while a 10 ms foreground heartbeat executes. It records positive deadline delay and asserts p95 below 50 ms. A cooperative macrotask yield separates background batches, matching the intended controlled-import scheduling. Playwright cross-browser flows remain the authority for real browser interaction behavior.

## Checked-in result

The report in [`generated/metadata-benchmark.json`](generated/metadata-benchmark.json) was produced on an Apple M4 Pro (12 logical CPUs, 24 GiB RAM), arm64 macOS, with Bun 1.3.10. It contains the exact commit, runtime, corpus, five measured samples per scan suite, instrumented counters, process-memory samples, comparisons, gate booleans, and measurement limitations.

At the checked-in run:

- large median scan throughput improved **15.12x**;
- deterministic peak retained allocation fell **99.85%**;
- the best-effort small median wall-clock measurement regressed **39.10%** (reported regression
  `0.3910`), illustrating the documented instability of the roughly one-millisecond samples;
- small deterministic copied work improved **96.86%**;
- scheduling delay p95 was **0.65 ms**;
- the largest candidate read was **32,768 bytes**; and
- all primary asserted gates passed; the explicitly non-gating best-effort wall-clock indicator did
  not pass in this run.

Wall-clock values on memory-backed synthetic `Blob`s can vary substantially across runtimes and machines. Regenerate the JSON on the same machine and corpus when comparing another implementation, inspect all five samples, and use the deterministic counters as the primary allocation and small-file evidence.
