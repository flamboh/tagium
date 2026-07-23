# Browser metadata engine

Tagium edits metadata locally without transcoding. The production module exposes two operations in
`metadataEngine/engine.ts`: inspect a `File`, or patch a `File` from canonical editable metadata.
Callers do not select a format. Detection uses container bytes and rejects an extension-only match.

## Module contract

Internally, a `ByteSource` provides bounded `read(offset, length)` calls and zero-copy `Blob.slice`
ranges. A registry selects an MP3, FLAC, or M4A adapter. Each adapter implements one small
`FormatDriver` interface: `inspect` returns the canonical projection plus container-derived technical
properties; `patch` returns a `PatchPlan` made of rewritten metadata bytes and original Blob slices.
No adapter asks the browser to decode or play the codec.

An empty patch returns the original Blob range, which makes a no-op export byte-identical. A real
patch rewrites only the owning metadata structure and splices untouched audio/container ranges into
the output. The engine preserves the detected source format and a sensible source extension
(`.mp3`, `.flac`, `.m4a`, or `.mp4`); names and MIME types are hints, never proof of format.

## Detection and limits

- MP3 requires two compatible complete MPEG frames, with an optional valid ID3v2 header.
- FLAC requires the `fLaC` marker and a valid, terminated metadata-block chain with STREAMINFO.
- M4A requires a valid ISO BMFF `ftyp`, `moov`, `mdat`, and an unencrypted AAC (`mp4a`) or ALAC
  audio track. Fragmented/encrypted/external-data-reference files are rejected rather than rewritten.
- A single metadata read is capped at 8 MiB. Larger permitted structures are read in bounded chunks;
  drivers additionally cap materialized metadata and atom counts. Arithmetic and all declared sizes
  are checked before output is assembled.
- Errors are typed Effect errors and identify empty, truncated, corrupt, encrypted, or unsupported
  input. A failed or canceled operation never mutates the original `File`.

## Read precedence and write policy

MP3 reads ID3v2 first, then APEv2, then ID3v1. It preserves the source ID3v2 major version when
present and preserves every unowned raw frame and all trailing stores. A new file without ID3v2 gets
ID3v2.4. Edited projection fields are represented once in ID3v2; opaque APEv2/ID3v1 bytes remain
untouched, so ID3v2 deterministically wins conflicts. Tag-level unsynchronisation, extended-header
presence, and ID3v2.4 footers are retained. On an actual edit, extended-header CRC/restriction data is
normalized to a valid minimal extended header because it describes the old tag; empty edits remain
byte-identical. Compressed, encrypted, grouped, data-length-indicated, or per-frame-unsynchronised
frames outside the editable projection remain opaque. If one of those flags protects a field Tagium
must edit or inspect, the driver rejects it with a typed error instead of guessing.
ID3v2.4 writes multiple genres as NUL-separated values. ID3v2.2/2.3 have no general multi-string
text-frame representation, so a UI-supplied array is deterministically serialized as one semicolon-
separated TCO/TCON value; existing unedited bytes are never normalized.

FLAC reads the first occurrence of each recognized Vorbis key. Patching replaces recognized keys in
the existing Vorbis-comment position while retaining the vendor string, ordering, duplicates outside
the edited key, ReplayGain, and unknown comments. Unknown metadata blocks are copied. Picture blocks
are copied unless artwork changed; a primary-cover UI edit retains secondary pictures. Audio begins at
the original post-metadata offset and is always a source slice.

M4A reads canonical iTunes `ilst` atoms before matching freeform atoms. Unknown atoms and duplicate
unowned entries remain in order. Artwork is unchanged unless explicitly edited, and a primary-cover
edit retains secondary artwork. When `moov` changes size, the adapter updates `stco`/`co64` entries by
mapping old media locations to the corresponding new `mdat` payload locations, including multiple
media-data regions. Atom sizes and required offset-table bytes are the documented structural
exception to byte-for-byte opaque preservation; media sample bytes and unknown payload bytes do not
change.

The editable canonical projection includes a separately parsed track total, although the current UI
only edits the track number. MP3 `n/total`, FLAC `TRACKNUMBER=n/total`, and MP4 `trkn` totals are
retained when the number changes. The model and driver seams leave disc totals, album artist,
composer, comments, BPM, ISRC, lyrics, and multi-value people data unowned and therefore preserved.

## Deliberate safe rejections

Tagium rejects fragmented MP4 (`moof`/`mvex`), encrypted tracks, external data references, and MP4
layouts with multiple or mixed audio/non-audio tracks. It also rejects edits to ID3 owned frames carrying the
unsupported per-frame transforms listed above. These inputs are never rewritten. Cancellation is
cooperative between bounded Blob reads; the platform does not expose cancellation for an individual
`Blob.arrayBuffer()` slice read, but neither partial failure nor cancellation mutates the source File
or commits a replacement workspace value.

## Adding a format

Implement `FormatDriver` using only bounded `ByteSource` reads, add byte-only detection, and register
the adapter in `engine.ts`. Tests must cover malformed sizes, no-op equality, canonical round trips,
unknown structure retention, multiple artwork, and an independent ordered audio-payload hash. A
driver may reject a legal but unsupported layout; it may never guess at a rewrite that could corrupt
audio.

## Verification commands

```sh
bun run typecheck
bun run lint
bun run test
bun run build
bun run conformance
bun run conformance:extended
bun run benchmark:metadata
bun run test:e2e -- tests/e2e/metadata-formats.spec.ts
```

The conformance report records oracle availability rather than treating a missing native executable
as a pass. See `metadata-format-research.md`, `metadata-conformance.md`, and
`metadata-benchmark.md` for source material, corpus design, oracle policy, and measured results.
