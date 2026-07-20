# Browser-local, lossless audio metadata I/O: format research

Research date: 2026-07-19. This note evaluates the formats and implementation
choices required for Tagium's metadata patch engine. Normative claims cite the
format owner or a standards body. Library claims cite the library's own source
or documentation.

## Executive recommendation

Build three small, purpose-specific readers and surgical patch planners on top
of Tagium's range-readable byte source. Do not adopt a general parser/writer as
the production preservation boundary.

- A reader should retain both a canonical projection and an ordered structural
  index whose leaves reference source ranges. A patch planner should replace
  only the owned leaves and assemble output from new metadata bytes plus
  original `Blob.slice()` ranges.
- Preserve every unedited frame, item, block, and atom as its exact source
  bytes. Preserve duplicates and ordering. A no-op returns the original
  `File`/`Blob`, not a reserialization.
- Keep the source tag version and container shape when it can represent the
  edit. Do not normalize a whole file merely because one field changed.
- Use independent native tools (TagLib, Mutagen, and ffprobe) only in the
  conformance harness. Their native runtimes and/or licenses do not make them
  an appropriate browser dependency.
- Use `music-metadata` only if a measured, pinned read-only adapter materially
  reduces work. Its broad format reader is useful, but it cannot establish
  byte-preserving writes. `browser-id3-writer`, `jsmediatags`, Mediabunny, and a
  normal MP4Box.js remux/write path do not meet the preservation contract.
- Initially accept unfragmented, unencrypted M4A/MP4 containing AAC or ALAC.
  Return a typed unsupported-structure error for fragmented movies, external
  data references, or protected/encrypted sample entries until their offset
  systems are fully modeled. Metadata inspection may still succeed.

The important design consequence is that “unknown” is not a parse error.
Unknown-but-well-bounded content is an opaque range to keep; invalid sizes,
impossible nesting, arithmetic overflow, or content that exceeds configured
resource limits are errors.

## Cross-format driver implications

The driver boundary should expose roughly these operations, without exposing
format-specific parse trees to application code:

1. `probe(source)`: bounded magic/structure validation, independent of name and
   MIME.
2. `inspect(source)`: canonical editable values, technical properties, artwork
   descriptors/ranges, opaque preservation state, and warnings about conflicts.
3. `planPatch(inspection, edits)`: a deterministic sequence of new byte chunks
   and original source ranges, plus the exact audio-essence ranges to hash.
4. `assemble(plan)`: a `Blob` composed from those chunks/ranges; it must not
   materialize media payloads in the JS heap.

All integer addition and multiplication must be checked before converting to a
JavaScript `number`. Reads need per-read and cumulative budgets, maximum nesting,
maximum item/frame counts, maximum decoded text, maximum artwork size/count, and
cancellation checks between reads. Box/block sizes are attacker-controlled.

Detection should require:

- MP3: a valid ID3 header followed by plausible MPEG audio, or multiple
  consecutive, internally consistent MPEG audio frame headers. `ID3` alone is
  insufficient.
- FLAC: `fLaC`, then one 34-byte STREAMINFO block in first position, sane block
  lengths, and an eventual last-metadata flag before plausible audio frames.
- M4A/MP4: a valid top-level box walk, a compatible `ftyp`, one usable `moov`,
  and at least one audio track whose sample entry is AAC (`mp4a`) or ALAC
  (`alac`). A generic MP4 video is not a Tagium audio input.

## MP3

### Authoritative structure

ID3v1 is exactly 128 trailing bytes beginning with `TAG`; ID3v1.1 repurposes the
last two comment bytes as zero plus a one-byte track number. The fields are
fixed-width title, artist, album, year, comment, and genre
([ID3.org ID3v1](https://id3.org/ID3v1)). There is no reliable encoding marker,
so decoding is necessarily a documented compatibility policy, not a Unicode
fact.

ID3v2.2 uses three-character frame identifiers and 24-bit frame sizes
([ID3v2.2](https://id3.org/id3v2-00)). ID3v2.3 changes to four-character frame
IDs/sizes, has tag-level unsynchronisation, optional extended headers, frame
compression/encryption/grouping flags, and permits ISO-8859-1 and UTF-16 text
([ID3v2.3](https://id3.org/id3v2.3.0)). ID3v2.4 uses synchsafe tag and frame
sizes, allows frame-level unsynchronisation, adds a possible footer, changes
extended-header and flag layouts, and adds UTF-8/UTF-16BE encodings
([v2.4 structure](https://id3.org/id3v2.4.0-structure),
[v2.4 frames](https://id3.org/id3v2.4.0-frames)). Major versions are not binary
compatible.

Padding is legal after frames. Its purpose is to allow metadata growth without
moving the audio bytes (explicitly described in the
[v2.2 specification](https://id3.org/id3v2-00) and later versions). A v2.4 tag
may appear before audio, or at the end when it carries a footer; the specification
also describes prepend/append combinations in its tag-location section
([ID3v2.4 structure, section 5](https://id3.org/id3v2.4.0-structure)).

APEv2 is an independent item store commonly found at the end of an MP3, before
an ID3v1 trailer. It has `APETAGEX` descriptors, little-endian sizes/counts,
UTF-8 text values, binary/external item types, and case-insensitive keys whose
original spelling matters. The original web specification is no longer a
dependable primary publication; therefore implementation should be checked
against both mature independent implementations:
[Mutagen's APEv2 implementation](https://github.com/quodlibet/mutagen/blob/master/mutagen/apev2.py)
and [TagLib's APE implementation](https://github.com/taglib/taglib/tree/master/taglib/ape).
Mutagen documents that it writes an APEv2 header and footer at the end
([Mutagen APEv2 API](https://mutagen.readthedocs.io/en/latest/api/ape.html)).

### Read precedence and write policy

Recommended canonical precedence is:

1. first supported, successfully decoded ID3v2 frame in the leading tag;
2. first APEv2 text item for the corresponding key;
3. ID3v1/1.1;
4. inferred filename only when all stores are absent.

Within one store, retain all duplicates, expose the first valid value as the
current scalar, and expose all artwork entries in order. Record conflicts as
non-fatal inspection warnings. Never merge duplicates into one opaque-free map.

On write, keep the leading ID3v2 major version and update only the exact owned
frame instances selected by policy. If no ID3v2 exists, create v2.4 (UTF-8,
synchsafe sizes) at the front. Synchronize an edited field into an existing
APEv2 item because otherwise APE-first readers can display stale values; retain
all unowned APE items byte-for-byte. For an existing ID3v1 tag, update only
values exactly representable in the configured single-byte codec and width.
When an edit is not exactly representable, zero that owned ID3v1 field and let
ID3v2/APEv2 be authoritative rather than silently transliterating or truncating.
Do not create ID3v1 or APEv2 when absent. This policy is deterministic and makes
loss visible instead of inventing text.

For artwork, edit the selected APIC/PIC instance or append a new one; never
replace every picture when one cover changes. An unrelated edit copies every
picture frame exactly.

### Preservation and parsing pitfalls

- Unsynchronisation changes the stored byte positions and frame size accounting.
  Parse framing in the version-specific order, but retain raw frame bytes. Do
  not de-unsynchronise and then reserialize untouched frames.
- v2.2 PIC stores a three-byte image format; v2.3/v2.4 APIC stores a MIME string.
  v2.2 frame IDs also need an explicit semantic mapping rather than padding a
  character onto the identifier.
- Unknown frame flags, encryption, or unsupported compression make that frame
  opaque, not deletable. If the user targets an unreadable owned frame, append a
  new plain frame and keep the opaque one, or return a typed conflict according
  to the chosen UI policy.
- Extended headers, CRC/restrictions, footer presence, experimental flags,
  frame grouping IDs, encryption method bytes, data-length indicators, duplicate
  frames, chapters (CHAP/CTOC), private (PRIV), and gapless encoder data must be
  retained. If an ID3v2 CRC covers changed bytes, recompute it or remove only the
  CRC declaration according to that version's specification; never retain an
  invalid CRC.
- The MP3 audio hash starts after all legal leading ID3v2 tags and ends before
  independently validated trailing APEv2/ID3v1 tags. It includes Xing/Info and
  LAME data located inside MPEG audio frames; those are not tags.
- Duration/bitrate must come from MPEG headers and Xing/VBRI information, with a
  bounded frame scan fallback. Browser decode capability is irrelevant.

## Native FLAC

### Authoritative structure

RFC 9639 is now the normative FLAC specification. A native FLAC begins with
`fLaC`, followed by metadata blocks, then audio frames. STREAMINFO must be the
first block and exactly one must exist. Each block has a last-block bit, a
7-bit type, and a 24-bit big-endian payload length. Defined types include
STREAMINFO, PADDING, APPLICATION, SEEKTABLE, VORBIS_COMMENT, CUESHEET, and
PICTURE; types 7–126 are reserved and type 127 is forbidden
([RFC 9639 section 8](https://www.rfc-editor.org/rfc/rfc9639.html#section-8)).

STREAMINFO directly provides sample rate, channel count, bits per sample, total
samples, and an MD5 of decoded PCM. It should remain exact during metadata edits
([RFC 9639 section 8.2](https://www.rfc-editor.org/rfc/rfc9639.html#section-8.2)).
Duration is `totalSamples / sampleRate`; average encoded bitrate can be derived
from the audio-frame byte range and duration without decoding.

Vorbis comments are a UTF-8 vendor string followed by an ordered list of
`NAME=value` fields; the lengths and count are 32-bit little-endian. Field names
are case-insensitive ASCII with constrained characters, values may contain any
valid UTF-8, and duplicates are allowed
([RFC 9639 section 8.6](https://www.rfc-editor.org/rfc/rfc9639.html#section-8.6),
[Xiph Vorbis comment specification](https://xiph.org/vorbis/doc/v-comment.html)).
The vendor string identifies the encoder and is not Tagium's property.

PICTURE blocks store a big-endian picture type, MIME, UTF-8 description,
dimensions/depth/colors, and picture-data length/data. Multiple PICTURE blocks
are legal subject to the type-specific restrictions in
[RFC 9639 section 8.8](https://www.rfc-editor.org/rfc/rfc9639.html#section-8.8).

### Read precedence and write policy

Use the first valid Vorbis-comment field for scalar canonical values while
retaining ordered duplicates. Field names compare case-insensitively. For date,
prefer `DATE`, then `YEAR`; for artist/genre, preserve multiple fields as
multiple canonical values even if the current UI displays a joined form.

Rewrite one VORBIS_COMMENT block in place in the metadata sequence, preserving
its vendor bytes and every unowned field byte/order. Update all case-insensitive
instances of a user-edited scalar to one deterministic encoded instance at the
position of the first, removing only redundant instances of that owned key. If
there is no comment block, add one immediately after STREAMINFO. Artwork edits
replace only the selected PICTURE block or append one after comments; unrelated
edits retain every picture block exactly.

### Preservation and structural exceptions

- Copy STREAMINFO, APPLICATION, SEEKTABLE, CUESHEET, unknown/reserved blocks,
  unedited PICTURE blocks, and all unowned comments byte-for-byte and in order.
- Prefer consuming or extending an adjacent PADDING block so the audio-frame
  start is unchanged. RFC 9639 explicitly defines padding for cheap metadata
  growth ([section 8.3](https://www.rfc-editor.org/rfc/rfc9639.html#section-8.3)).
  If padding is insufficient, shifting the untouched audio range is legal; only
  metadata block sizes and last-block bits need change. The encoded audio-frame
  bytes and STREAMINFO PCM MD5 remain identical.
- Recompute the last-block flag deterministically. Split padding only when the
  resulting block is representable; each payload is limited by the 24-bit size.
- This scope is native FLAC only. Ogg FLAC requires repagination, page sequence
  numbers, lacing, and CRC updates; RFC 9639 defines that mapping separately
  ([section 10.1](https://www.rfc-editor.org/rfc/rfc9639.html#section-10.1)). A
  renamed Ogg FLAC must therefore receive a typed unsupported-container error.
- The audio essence hash is exactly the source range after the last metadata
  block through EOF. No audio-frame parsing is required to preserve/hash it,
  although bounded header checks should validate that the boundary is plausible.

## M4A / ISO base media / QuickTime atoms

### Authoritative structure

QuickTime atoms are hierarchical boxes with a big-endian 32-bit size and type.
Size `1` introduces a 64-bit extended size; top-level size `0` extends to EOF.
Unknown atoms must be skipped using their declared size, which is the format's
forward-compatibility mechanism
([Apple, Atoms](https://developer.apple.com/documentation/quicktime-file-format/atoms)).
The ISO terminology “box” is functionally equivalent to QuickTime “atom,” but
the brands and permitted structures still matter
([Apple, QuickTime File Format](https://developer.apple.com/documentation/quicktime-file-format)).

Apple's specified key-based metadata uses a `meta` container with `hdlr`,
`keys`, and `ilst`, permits multiple localized/typed values, and may occur at
movie, track, or media level. Apple states that metadata takes precedence over
same-location legacy user data
([Metadata atoms and types](https://developer.apple.com/documentation/quicktime-file-format/metadata_atoms_and_types)).
Apple publishes `mdta` keys for album, artist, artwork, and other values
([QuickTime metadata keys](https://developer.apple.com/documentation/quicktime-file-format/quicktime_metadata_keys)).

Music-library M4A convention additionally stores iTunes four-character items
such as `©nam`, `©ART`, `©alb`, `©day`, `©gen`/`gnre`, `trkn`, and `covr` under
`moov/udta/meta/ilst`. Freeform `----` entries carry `mean`, `name`, and one or
more `data` children. This convention is incompletely covered by Apple's current
public QTFF pages, so use two independent mature source implementations as the
compatibility definition:
[Mutagen MP4](https://github.com/quodlibet/mutagen/tree/master/mutagen/mp4) and
[TagLib MP4](https://github.com/taglib/taglib/tree/master/taglib/mp4).
The implementation must test its emitted bytes with both, not assume a single
reverse-engineered map is normative.

Codec-independent technical metadata comes from the movie/track/media headers
and audio sample description. AAC is normally `mp4a` with an `esds` decoder
configuration; ALAC is `alac` with its codec configuration. Duration comes from
the media/movie timescale and duration (including edit-list semantics if shown to
the user), while sample rate is in the audio sample entry/configuration. Editing
does not require either codec to be decodable by the browser.

### Read precedence and write policy

For an audio-library M4A, prefer movie-level iTunes `ilst` values, then movie-
level `mdta` keys, then corresponding track-level metadata. Within a key, keep
all `data` children and duplicate items in source order; use the first valid
value for a scalar UI field. Keep all `covr` values as separate artwork entries.
Surface conflicts as warnings.

When the selected authoritative store already exists, replace only the owned
item/data value(s) there and retain every sibling and unknown child byte-for-byte.
Do not delete legacy and `mdta` stores merely because they conflict. When no
supported store exists, create iTunes-style `moov/udta/meta/ilst`, because that
is the broadest music-player compatibility target. Write UTF-8 text; preserve
integer/binary encodings for `trkn`, `disk`, `gnre`, and artwork data-type flags.
An unrelated edit must copy every `covr`, freeform, reverse-DNS, gapless,
ReplayGain, chapter, and unknown item exactly.

### Offset and preservation pitfalls

- Atom sizes must be updated through every changed ancestor. `meta` is a full
  atom in the relevant layouts, so its four version/flag bytes are not a child
  header. Preserve 32-bit versus extended-size form unless growth requires a
  legal change.
- Preserve every unknown leaf and container child as an exact range, including
  top-level atoms. Container type alone is not enough to infer the child start.
- `stco`/`co64` entries are absolute file offsets, not offsets relative to
  `mdat`. Apple explicitly warns that growing a front `moov` changes them
  ([Chunk offset atom](https://developer.apple.com/documentation/quicktime-file-format/chunk_offset_atom)).
  A safe planner maps each old media byte range to its new output range and
  translates every chunk offset through that map. If a translated 32-bit value
  overflows, converting `stco` to `co64` changes `moov` size and requires a
  fixed-point layout pass.
- Prefer absorbing size changes in an existing `free`/`skip` sibling so `moov`
  and all later media offsets remain unchanged. A `free` box must remain at
  least a legal header; tiny remainder bytes cannot be emitted as a box.
- Multiple `mdat` boxes are legal. Hash the ordered sample payload ranges
  resolved through every audio track's sample tables, not merely the bytes of
  the first `mdat`; non-sample gaps inside `mdat` are not audio essence.
- Fragmented files add `moof`/`traf`/`tfhd`/`trun`, base-data offsets, and
  potentially `sidx`/`tfra` offset relationships. External data references and
  encrypted sample entries add more preservation/security obligations. Reject
  these for write until explicitly implemented and covered; never “fix” them by
  remuxing.
- A size-zero top-level `mdat` must be last. Appending metadata behind it without
  rewriting its size makes the new bytes part of media data. Treat this layout
  specially or reject growth.
- No-op output must bypass serialization. Even a semantically equivalent
  box-order or padding rewrite violates the byte-equality gate.

## Browser library audit

| Candidate                                                             | Browser / I/O                                                                                                                                                                                                                              | Write and preservation finding                                                                                                                                                                                                                        | Recommendation                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [`music-metadata`](https://github.com/Borewit/music-metadata)         | Actively maintained ESM; `parseBlob` and tokenizer abstractions support browser/seekable sources. It covers all target readers and has a broad dependency graph ([npm package](https://www.npmjs.com/package/music-metadata)).             | Read-only. Its normalized output is not an ordered, raw preservation model, and it cannot plan surgical output. Pulling all format parsers also has avoidable bundle impact; measure an exact pinned build before use.                                | Optional pinned read-only helper or oracle cross-check, never the writer/preservation authority.                        |
| [`browser-id3-writer`](https://github.com/egoroof/browser-id3-writer) | Browser-oriented but its documented API starts with the entire song `ArrayBuffer` ([npm README](https://www.npmjs.com/package/browser-id3-writer)).                                                                                        | Writes ID3v2.3 only. Whole-buffer input violates bounded I/O; version conversion and tag regeneration cannot promise unknown v2.2/v2.4/APEv2 preservation.                                                                                            | Reject.                                                                                                                 |
| [`jsmediatags`](https://github.com/aadsm/jsmediatags)                 | Browser reader with MP3/MP4/FLAC readers, but older Browserify-era architecture.                                                                                                                                                           | Read-only and normalized; no surgical writer or opaque preservation guarantee.                                                                                                                                                                        | Reject as production dependency.                                                                                        |
| [`mp4box.js`](https://github.com/gpac/mp4box.js)                      | Mature GPAC project, progressive `fileStart`-annotated buffers, browser ESM. “simple” is parse-only; “all” adds writing/sample processing.                                                                                                 | Excellent structural reference and test oracle, but its advertised write path is box writing/fragmentation, not a metadata-only, byte-identical unknown-box patch contract. The full flavor adds substantial unused surface.                          | Study/source-check; at most pin a parser subset after bundle and preservation tests. Prefer the small local box walker. |
| [`Mediabunny`](https://github.com/Vanilagy/mediabunny)                | Modern pure TypeScript/browser toolkit with `BlobSource`, metadata reading, and tree-shakable APIs.                                                                                                                                        | Output APIs create/remux media. Public `raw` metadata access is useful but is not a promise to retain arbitrary duplicate/unknown atoms or original box bytes. MPL-2 also requires a deliberate dependency review.                                    | Useful reference/benchmark, not the preservation writer.                                                                |
| TagLib / Mutagen / ffprobe                                            | Native command-line/library tools; broad, mature format support. Mutagen is GPL-2.0-or-later ([source](https://github.com/quodlibet/mutagen)); TagLib is LGPL/MPL ([source](https://github.com/taglib/taglib)); ffprobe is part of FFmpeg. | Independent parsers are valuable external oracles, but running them in production would violate the local-browser architecture or add large WASM/license/heap costs. Writers may normalize tags, so compare semantic and opaque assertions carefully. | Pin exact versions in the conformance environment only.                                                                 |

No candidate's feature list is evidence of the required preservation guarantee.
Adoption would require, at minimum: no-op byte equality; unknown/duplicate
round-trips; multi-artwork retention; audio-range hashes; malformed-size limits;
range-read instrumentation; three-browser determinism; bundle analysis; and a
maintenance/license record pinned to an exact version.

## Conformance consequences

The corpus should encode the format distinctions rather than only field values:

- MP3: all three ID3v2 majors, all permitted text encodings, tag/frame
  unsynchronisation, extended headers, footer, padding, opaque flagged frames,
  duplicates, leading/trailing arrangements, ID3v1/1.1, APEv2 with/without
  header, and all coexistence orders that independent tools accept.
- FLAC: comments in varied order/case with duplicates and unusual UTF-8,
  multiple PICTURE blocks, APPLICATION/SEEKTABLE/CUESHEET/reserved blocks,
  zero/multiple padding blocks, near-24-bit lengths, invalid last flags, and
  truncated block headers. Keep native and Ogg FLAC detection cases distinct.
- MP4: both 32/64-bit atom sizes, `meta` variants, iTunes and `mdta` stores,
  duplicate/freeform/covr data, unknown atoms at every preserved level,
  `moov` before/after one or multiple `mdat`, `free` growth/no-growth, `stco`
  boundary conversion, size-zero atoms, AAC and ALAC, and rejected fragmented,
  encrypted, external-reference, and non-audio files.

Every accepted write should assert: canonical golden values; original byte
identity on no-op; exact bytes for all opaque nodes; unchanged ordered encoded
audio payload hash; independent TagLib/Mutagen readback; ffprobe/container
validation; deterministic output bytes across Chromium, Firefox, and WebKit;
and no individual source read above the configured 8 MiB gate.

## Standards and source index

- ID3: [ID3v1](https://id3.org/ID3v1),
  [ID3v2.2](https://id3.org/id3v2-00),
  [ID3v2.3](https://id3.org/id3v2.3.0),
  [ID3v2.4 structure](https://id3.org/id3v2.4.0-structure), and
  [ID3v2.4 frames](https://id3.org/id3v2.4.0-frames).
- FLAC: [RFC 9639](https://www.rfc-editor.org/rfc/rfc9639.html) and the
  [Xiph Vorbis comment specification](https://xiph.org/vorbis/doc/v-comment.html).
- MP4/QuickTime: [QuickTime File Format](https://developer.apple.com/documentation/quicktime-file-format),
  [Atoms](https://developer.apple.com/documentation/quicktime-file-format/atoms),
  [Metadata atoms and types](https://developer.apple.com/documentation/quicktime-file-format/metadata_atoms_and_types),
  [QuickTime metadata keys](https://developer.apple.com/documentation/quicktime-file-format/quicktime_metadata_keys), and
  [Chunk offset atom](https://developer.apple.com/documentation/quicktime-file-format/chunk_offset_atom).
- Ecosystem source definitions and oracle implementations:
  [Mutagen](https://github.com/quodlibet/mutagen),
  [TagLib](https://github.com/taglib/taglib),
  [MP4Box.js](https://github.com/gpac/mp4box.js), and
  [music-metadata](https://github.com/Borewit/music-metadata).
