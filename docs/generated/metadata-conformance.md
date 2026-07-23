# Tagium metadata conformance report

Generated: 2026-07-20T20:08:22.065Z<br>
Seed: `1413564233`<br>
Manifest digest: `ee2420231512a47264276090c278703702b4893efcab0301f895fcaf1b1b4fe9`

## Summary

| Passed | Failed | Skipped | Corpus cases | Adversarial cases |
| -----: | -----: | ------: | -----------: | ----------------: |
|     38 |      0 |       0 |          540 |                54 |

Family counts: MP3 180, FLAC 180, M4A 180.

## Assertions

| Status | Assertion                                                              | Detail                             |
| ------ | ---------------------------------------------------------------------- | ---------------------------------- |
| passed | corpus contains at least 500 cases                                     | 540 cases                          |
| passed | mp3: format family represented                                         | 180 cases                          |
| passed | flac: format family represented                                        | 180 cases                          |
| passed | m4a: format family represented                                         | 180 cases                          |
| passed | corpus feature: duplicates                                             | 135 cases                          |
| passed | corpus feature: multiple-artwork                                       | 57 cases                           |
| passed | corpus feature: large-artwork                                          | 3 cases                            |
| passed | corpus feature: long-text                                              | 90 cases                           |
| passed | corpus feature: unicode                                                | 450 cases                          |
| passed | corpus feature: mislabeled                                             | 18 cases                           |
| passed | corpus feature: malformed-or-truncated                                 | 36 cases                           |
| passed | manifest generation is deterministic                                   |                                    |
| passed | independent structural audio-payload hashes reproduce                  | 0 mismatches                       |
| passed | adversarial fixtures are structurally rejected                         | 0 unexpectedly accepted            |
| passed | mp3: production inspect accepts every valid corpus fixture             | 162/162 inspected                  |
| passed | mp3: canonical editable projection matches golden metadata             | 162/162 golden projections matched |
| passed | mp3: production no-op patch is byte-identical                          | 162/162 byte-identical             |
| passed | mp3: production edit preserves independent audio hash                  | 162/162 edits preserved essence    |
| passed | mp3: production rejects every adversarial corpus fixture               | 18/18 rejected                     |
| passed | flac: production inspect accepts every valid corpus fixture            | 162/162 inspected                  |
| passed | flac: canonical editable projection matches golden metadata            | 162/162 golden projections matched |
| passed | flac: production no-op patch is byte-identical                         | 162/162 byte-identical             |
| passed | flac: production edit preserves independent audio hash                 | 162/162 edits preserved essence    |
| passed | flac: production rejects every adversarial corpus fixture              | 18/18 rejected                     |
| passed | m4a: production inspect accepts every valid corpus fixture             | 162/162 inspected                  |
| passed | m4a: canonical editable projection matches golden metadata             | 162/162 golden projections matched |
| passed | m4a: production no-op patch is byte-identical                          | 162/162 byte-identical             |
| passed | m4a: production edit preserves independent audio hash                  | 162/162 edits preserved essence    |
| passed | m4a: production rejects every adversarial corpus fixture               | 18/18 rejected                     |
| passed | mp3: edit preserves audio essence, opaque metadata, and extra artwork  |                                    |
| passed | flac: edit preserves audio essence, opaque metadata, and extra artwork |                                    |
| passed | m4a: edit preserves audio essence, opaque metadata, and extra artwork  |                                    |
| passed | mp3: mutation runner completed without harness crashes                 | 333333/333333, 0 crashes           |
| passed | flac: mutation runner completed without harness crashes                | 333333/333333, 0 crashes           |
| passed | m4a: mutation runner completed without harness crashes                 | 333334/333334, 0 crashes           |

## Seeded mutation testing

| Family | Completed | Accepted | Rejected | Crashes | Digest                                                             |
| ------ | --------: | -------: | -------: | ------: | ------------------------------------------------------------------ |
| mp3    |    333333 |   220723 |   112610 |       0 | `806014e8801108f234937c31b0b324d45192d6110e36e690b142f52ac8164e9d` |
| flac   |    333333 |   186707 |   146626 |       0 | `a939f8ed2dbba5b28b8ad199077be2809bf09659b73cad227d8824600753cbca` |
| m4a    |    333334 |   156301 |   177033 |       0 | `8e752f9873334f4d10c6d2de671c4bfe35229e1ef2cf5b27b96fe47375d6185e` |

## Independent external oracles

| Oracle  | Status | Version                                                             | Cases | Detail                                                                                                                                                                                                                                                                               |
| ------- | ------ | ------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ffprobe | passed | ffprobe version 8.1.1 Copyright (c) 2007-2026 the FFmpeg developers |    13 | 8/9 synthetic inputs and outputs readable with 8 patched titles; 4/4 decoder-valid MP3, FLAC, AAC, and ALAC patched outputs decoded; by family {"mp3":{"input":3,"output":3,"title":3},"flac":{"input":3,"output":3,"title":3},"m4a":{"input":2,"output":2,"title":2}}; pinned 8.1.1 |
| mutagen | passed | 1.47.0                                                              |     9 | 9/9 inputs and 9/9 patched outputs recognized; 9 patched titles confirmed; by family {"mp3":{"input":3,"output":3,"title":3},"flac":{"input":3,"output":3,"title":3},"m4a":{"input":3,"output":3,"title":3}}; pinned 1.47.0                                                          |
| taglib  | passed | 2.3                                                                 |     9 | 9/9 inputs and 9/9 patched outputs recognized; 9 patched titles confirmed; by family {"mp3":{"input":3,"output":3,"title":3},"flac":{"input":3,"output":3,"title":3},"m4a":{"input":3,"output":3,"title":3}}; pinned 2.3                                                             |

Oracle availability is explicit: missing optional executables are reported as skipped, never silently treated as passing. The structural corpus deliberately uses tiny encoded payloads; the FFmpeg oracle separately generates and decodes patched decoder-valid MP3, FLAC, AAC, and ALAC samples.
