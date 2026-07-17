# FLAC writer bake-off — 2026-07-17

## Decision: stop now; candidate not approved

Do not ship or advertise FLAC upload/edit/export in this PR. `taglib-wasm@1.5.2`
is promising on the tested preservation cases, but there is no accepted physical iOS or
Android memory measurement in this environment. The plan explicitly requires measured
mobile memory. That missing evidence leaves the Phase 1 mobile gate unmet and is the
reason to stop now; the Bun measurements below are not a substitute for browser/mobile
measurements. The malformed-input screen also found cases needing policy or wrapper
hardening before this candidate could be approved.

The format-explicit MP3 architecture on the parent branch remains useful and should land
independently. Cobalt and URL imports remain MP3-only.

## Reproduce

Prerequisites: Bun 1.3.10+, `ffmpeg` on `PATH`, and approximately 3 GiB of free memory.

```sh
bun install
bun run evidence:flac
```

The executable assertion corpus is
[`scripts/flac-writer-bakeoff.ts`](../../scripts/flac-writer-bakeoff.ts). It generates
redistributable synthetic FLAC fixtures under `/tmp/tagium-flac-bakeoff-evidence` and
writes the machine-readable result to `results.json` in that directory. Generated audio
is a deterministic sine wave, so no copyrighted media is stored in the repository.

## Candidate

- `taglib-wasm@1.5.2`, published 2026-07-16; current maintained release at evaluation.
- Browser entry: 101,287 bytes raw / 21,782 bytes gzip.
- Browser wrapper chunk: 51,334 bytes raw / 13,411 bytes gzip.
- Browser WASM: 683,733 bytes raw / 225,895 bytes gzip.
- Sum of those installed artifacts: 836,354 bytes raw / 261,088 bytes when each artifact
  is gzipped independently.
- Independent reread: `music-metadata@11.8.3`.

These are package-file sizes, not a production Tagium bundle measurement. A bundler may
rewrite or split the wrapper, tree-shake JavaScript, emit the WASM separately, and apply
different compression. If reconsidered, the dependency should be lazy-loaded in a worker
and the actual production chunks measured; this bake-off did not implement that product
path.

The package's documentation says browsers and Web Workers use Emscripten and load the
entire file into memory, while its seek-based partial path is for filesystem runtimes.
That statement is upstream documentation, not a browser-memory measurement from this run.

## Preservation and correctness results

All positive checks below passed on generated native FLAC files. The script fails
immediately if one regresses. This is a focused corpus, not a claim that all FLAC metadata
blocks or Xiph tag dialects are preserved.

| Check                      | Evidence                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent reread         | `music-metadata@11.8.3` reread the writer output.                                                                                                                                     |
| Common fields              | Edited title, the two exact artist values, album, preserved full date/year, genre, track number, and edited comment were asserted after independent reread.                           |
| Advanced/Xiph fields       | Album artist, composer, disc number, and BPM round-tripped.                                                                                                                           |
| Unicode                    | The asserted title contains Japanese, emoji, and accented Latin; the asserted comment contains Hebrew; the asserted composer contains Greek.                                          |
| Repeated values            | Two `ARTIST` values survived as two values.                                                                                                                                           |
| Unknown Vorbis comments    | `X_TAGIUM_SENTINEL=preserve-me` survived semantically.                                                                                                                                |
| Non-modeled metadata block | One injected APPLICATION block (`TGM0` sentinel) survived byte-for-byte across tag and artwork edits. No broader unknown-block corpus was run.                                        |
| Artwork                    | Front-cover add and replace were independently reread and asserted for exact bytes, `image/png` MIME, front-cover type, and exact description; removal was reread and asserted empty. |
| Encoded audio              | SHA-256 of the bytes from the first audio frame onward remained `6e4b9a61e7d87648db2e98c660db85af4787636023b9e8c8bc1f284723843d13`.                                                   |

The payload hash is stronger for this purpose than comparing FLAC STREAMINFO's decoded
audio MD5: it proves the encoded frame bytes themselves were not rewritten.

### Malformed-input screen

The screen calls `open()` and `isValid()`; it does not claim later save behavior. `true`
means the candidate rejected that mutation at this boundary.

| Mutation                                     | Rejected at open/validation |
| -------------------------------------------- | --------------------------- |
| Truncated before complete STREAMINFO         | Yes                         |
| Missing `fLaC` marker                        | Yes                         |
| Metadata-block length beyond input           | Yes                         |
| Reserved metadata-block type 127             | Yes                         |
| Duplicate STREAMINFO block                   | **No**                      |
| Vorbis comment with inconsistent field count | **No**                      |
| Truncated PICTURE block                      | **No**                      |

This mixed result is not a broad fail-closed guarantee. A future adapter would need an
explicit, tested admission layer and product policy. No oversized-file or artwork-size
admission wrapper was built, and no product size threshold is claimed by this artifact.

## Time and isolated peak memory

Measured on Apple Silicon macOS 26 with Bun 1.3.10 using taglib-wasm's Bun/WASI runtime
while passing each complete fixture as a `Uint8Array`. Each row ran in a fresh process.
Peak RSS is `process.resourceUsage().maxRSS`; the increase subtracts the initialized
runtime's baseline. These are Bun/WASI buffer-path measurements only. They are not browser
or mobile measurements and cannot establish browser amplification or a mobile limit.

| Fixture             | Meaning                     |     Input |  Write | Baseline RSS |  Peak RSS | Peak increase | Amplification vs input |
| ------------------- | --------------------------- | --------: | -----: | -----------: | --------: | ------------: | ---------------------: |
| `small.flac`        | 5 minutes                   |  3.54 MiB |   6 ms |     88.7 MiB | 125.5 MiB |      36.9 MiB |                  10.4× |
| `sixty-minute.flac` | 60 minutes                  |  42.9 MiB |  30 ms |     87.7 MiB | 519.3 MiB |     431.6 MiB |                  10.1× |
| `large.flac`        | 6 hours / large-file stress | 275.0 MiB | 202 ms |     87.7 MiB |  2.77 GiB |      2.69 GiB |                  10.0× |

These results identify a cost worth investigating, but they do not prove the same ratio in
Emscripten browsers. A worker would isolate work from the UI thread, but its browser memory
and transfer behavior still must be measured. Without accepted physical-device evidence,
no mobile file-size or artwork-size policy is proposed.

## Licensing and relinking obligations

This is a mixed-license dependency:

- TypeScript/JavaScript wrapper: MIT. Preserve the MIT copyright and permission notice.
- `taglib-web.wasm` and `taglib-wasi.wasm`: LGPL-2.1-or-later, inherited from TagLib.
- The installed package's `LICENSE` explicitly requires consumers to let users relink with
  a modified TagLib and points to the upstream `lib/taglib/` source and `npm run build:wasm`.

The following is an engineering compliance checklist inferred from the package notice,
not a legal conclusion. If this candidate is later distributed, counsel should determine
the actual obligations and approve the mechanism. Likely work includes:

1. Ship the wrapper's MIT notice and the complete LGPL notice with the application.
2. Publish or provide alongside the WASM the exact corresponding TagLib source, wrapper
   source/build scripts, toolchain instructions, and any local modifications used to make
   that binary—not merely a link to a moving `main` branch.
3. Keep the WASM a separately loaded asset and document how a recipient can rebuild and
   substitute a modified compatible binary. Tagium's source and build must not prevent
   that replacement.
4. Publish modifications to the LGPL-covered TagLib code under LGPL-2.1-or-later and not
   prohibit reverse engineering needed to debug such modifications.
5. Have counsel confirm the web-distribution/relinking mechanism before release.

The npm tarball examined contains the wrapper license and compiled WASM, but not the
referenced `lib/taglib/` directory. Whether and how Tagium must provide corresponding
source and a relink path requires legal review; engineering should plan for an explicit,
version-pinned source artifact and reproducible relink guide rather than assuming the
tarball is sufficient.

## Narrow alternative screen

`@akabeko/music-metadata-editor@1.0.1` is maintained, MIT licensed, and its public API does
accept `Uint8Array` for reads and writes. Its package declares Node 24+, exposes no separate
browser entry, and the published graph imports `node:buffer`, `node:path`, and
`node:fs/promises`.

An actual smoke was run: a vanilla Vite browser bundle completed after externalizing those
Node built-ins, but headless Chromium failed during module initialization with
`TypeError: Cannot read properties of undefined (reading 'from')` at a `Buffer.from` call,
before the FLAC write executed. This shows the published entry is not browser-ready in
Tagium's current unpolyfilled Vite setup. It does **not** prove the library cannot work with
carefully selected polyfills, a narrower source import, or upstream browser changes. Those
paths and the alternative's preservation/memory corpus remain untested, so this is not an
exhaustive alternative rejection.

The smoke is reproducible with `bun run evidence:flac-alternative`; it generates its own
one-second FLAC fixture and temporary Vite bundle under `/tmp`.

A product-owned binary writer was not pursued because the plan excludes compensating for
a failed gate with a broad custom writer.

## What would reopen the gate

Reconsider only when all of these are available:

- a browser-integrated candidate (TagLib or an alternative) with a focused adapter and
  expanded preservation/malformed corpus;
- physical iOS Safari and Android Chrome runs for 5-minute, 60-minute, and policy-limit
  inputs, recording browser survival, peak memory, write time, and download completion;
- an accepted file-size/artwork policy derived from those device measurements;
- for TagLib, a legally reviewed, reproducible corresponding-source and relinking path.

Until then, support copy must continue to say MP3 only.

## Primary references

- [RFC 9639 — FLAC file-level metadata and frame structure](https://www.rfc-editor.org/rfc/rfc9639.html)
- [TagLib-Wasm repository and licensing](https://github.com/CharlesWiltgen/TagLib-Wasm)
- [TagLib-Wasm browser/runtime documentation](https://charleswiltgen.github.io/TagLib-Wasm/guide/platform-examples.html)
- [Xiph Vorbis comment specification](https://xiph.org/vorbis/doc/v-comment.html)
- [`music-metadata` repository](https://github.com/Borewit/music-metadata)
- [`@akabeko/music-metadata-editor` repository](https://github.com/akabekobeko/npm-music-metadata-editor)
