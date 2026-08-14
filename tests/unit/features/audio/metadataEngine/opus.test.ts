import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { makeBlobByteSource } from "@/features/audio/metadataEngine/byteSource";
import { opusDriver } from "@/features/audio/metadataEngine/opus";
import {
  concatOpusFixtureBytes,
  opusFixtureBase64,
  opusFixtureCrc,
  opusHeadPacket,
  opusOggPage,
  opusPictureBlock,
  opusTagsPacket,
  validOpusBytes,
} from "../../../support/opusTestFixtures";

const readLe32 = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! +
  bytes[offset + 1]! * 0x100 +
  bytes[offset + 2]! * 0x1_0000 +
  bytes[offset + 3]! * 0x100_0000;

interface FixturePage {
  readonly bytes: Uint8Array;
  readonly sequence: number;
  readonly headerType: number;
  readonly segments: Uint8Array;
  readonly body: Uint8Array;
}

const fixturePages = (bytes: Uint8Array) => {
  const pages: FixturePage[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const segmentCount = bytes[offset + 26]!;
    const segments = bytes.slice(offset + 27, offset + 27 + segmentCount);
    const bodyLength = segments.reduce((total, length) => total + length, 0);
    const length = 27 + segmentCount + bodyLength;
    const page = bytes.slice(offset, offset + length);
    pages.push({
      bytes: page,
      sequence: readLe32(page, 18),
      headerType: page[5]!,
      segments,
      body: page.slice(27 + segmentCount),
    });
    offset += length;
  }
  return pages;
};

const outputBytes = async (parts: BlobPart[]) =>
  new Uint8Array(await new Blob(parts).arrayBuffer());

const containsBytes = (haystack: Uint8Array, needle: Uint8Array) => {
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset++) {
    for (let index = 0; index < needle.length; index++) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
};

const comments = [
  "TITLE=first title",
  "TITLE=duplicate title",
  "ARTIST=Artist",
  "ALBUMARTIST=Album Artist",
  "ALBUM=Album",
  "COMPOSER=Composer",
  "COMMENT=Primary comment",
  "COPYRIGHT=Copyright",
  "LANGUAGE=eng",
  "DISCNUMBER=2/3",
  "BPM=128",
  "DATE=2024-03-01",
  "GENRE=Electronic",
  "GENRE=Ambient",
  "TRACKNUMBER=3/12",
  "REPLAYGAIN_TRACK_GAIN=-7.1 dB",
  "X-private=opaque value",
  `METADATA_BLOCK_PICTURE=${opusFixtureBase64(opusPictureBlock())}`,
];

describe("Opus metadata driver", () => {
  it("reads Vorbis comments, pictures, and Opus stream facts", async () => {
    const inspected = await Effect.runPromise(
      opusDriver.inspect(makeBlobByteSource(new Blob([validOpusBytes({ comments })]))),
    );

    expect(inspected.format).toEqual({
      kind: "opus",
      extension: "opus",
      mime: "audio/ogg",
    });
    expect(inspected.metadata).toMatchObject({
      title: "first title",
      artist: "Artist",
      albumArtist: "Album Artist",
      album: "Album",
      composer: "Composer",
      comment: "Primary comment",
      discNumber: 2,
      bpm: 128,
      year: 2024,
      genre: ["Electronic", "Ambient"],
      duration: 2,
      sampleRate: 48_000,
      trackNumber: 3,
      trackTotal: 12,
    });
    expect(inspected.metadata.picture).toHaveLength(1);
    expect(inspected.metadata.picture[0]).toMatchObject({
      format: "image/png",
      type: 3,
      description: "front",
      width: 1,
      height: 1,
      depth: 24,
      data: Uint8Array.of(1, 2, 3),
    });
  });

  it("accepts custom mappings whose decoded and output channel counts differ", async () => {
    const head = opusHeadPacket(312, {
      channels: 2,
      family: 255,
      streams: 1,
      coupled: 0,
      indices: [0, 0],
    });
    const inspected = await Effect.runPromise(
      opusDriver.inspect(makeBlobByteSource(new Blob([validOpusBytes({ head })]))),
    );

    expect(inspected.metadata).toMatchObject({
      title: "fixture title",
      sampleRate: 48_000,
    });
  });

  it("returns the original source for an empty patch and treats duplicate replacement as an edit", async () => {
    const original = validOpusBytes({ comments });
    const source = makeBlobByteSource(new Blob([original]));
    const empty = await Effect.runPromise(opusDriver.patch(source, {}));
    const equivalent = await Effect.runPromise(opusDriver.patch(source, { title: "first title" }));

    expect(empty.parts).toHaveLength(1);
    expect(await outputBytes(empty.parts)).toEqual(original);
    // Replacing duplicate owned comments is still a real edit, even if the first value is unchanged.
    expect(await outputBytes(equivalent.parts)).not.toEqual(original);

    const singleTitle = validOpusBytes();
    const sameValue = await Effect.runPromise(
      opusDriver.patch(makeBlobByteSource(new Blob([singleTitle])), {
        title: "fixture title",
      }),
    );
    expect(sameValue.parts).toHaveLength(1);
    expect(await outputBytes(sameValue.parts)).toEqual(singleTitle);
  });

  it("patches all editable fields while preserving unknown comments, trailing data, and audio bodies", async () => {
    const trailing = Uint8Array.of(0x01, 0xff, 0x80, 0, 0xde, 0xad, 0xbe, 0xef);
    const audioBodies = [
      Uint8Array.of(0xf8, 0xaa, 0xbb, 0xcc),
      Uint8Array.of(0xf8, 0x10, 0x20, 0x30, 0x40),
    ];
    const original = validOpusBytes({ comments, trailing, audioBodies });
    const plan = await Effect.runPromise(
      opusDriver.patch(makeBlobByteSource(new Blob([original])), {
        title: "Changed 🦊",
        artist: "New Artist",
        albumArtist: "New Album Artist",
        album: "New Album",
        composer: "New Composer",
        comment: "New comment",
        copyright: "New copyright",
        language: "fra",
        dateText: "2030-05-06",
        genre: ["Rock", "Pop"],
        trackText: "4/12",
        discNumber: 1,
        bpm: 140,
        picture: [
          {
            format: "image/jpeg",
            type: 3,
            description: "replacement",
            data: Uint8Array.of(9, 8, 7),
          },
        ],
      }),
    );
    const patched = await outputBytes(plan.parts);
    const inspected = await Effect.runPromise(
      opusDriver.inspect(makeBlobByteSource(new Blob([patched]))),
    );

    expect(inspected.metadata).toMatchObject({
      title: "Changed 🦊",
      artist: "New Artist",
      albumArtist: "New Album Artist",
      album: "New Album",
      composer: "New Composer",
      comment: "New comment",
      year: 2030,
      genre: ["Rock", "Pop"],
      trackNumber: 4,
      trackTotal: 12,
      discNumber: 1,
      bpm: 140,
    });
    expect(inspected.metadata.picture[0]).toMatchObject({
      format: "image/jpeg",
      description: "replacement",
      data: Uint8Array.of(9, 8, 7),
    });
    const decoded = new TextDecoder().decode(patched);
    expect(decoded).toContain("REPLAYGAIN_TRACK_GAIN=-7.1 dB");
    expect(decoded).toContain("X-private=opaque value");
    expect(decoded).toContain("COPYRIGHT=New copyright");
    expect(decoded).toContain("LANGUAGE=fra");
    expect(containsBytes(patched, trailing)).toBe(true);

    const pages = fixturePages(patched);
    expect(pages.slice(-audioBodies.length).map((page) => page.body)).toEqual(audioBodies);

    const clearedPlan = await Effect.runPromise(
      opusDriver.patch(makeBlobByteSource(new Blob([patched])), {
        title: "",
        genre: "",
        trackNumber: null,
        discNumber: null,
        bpm: null,
        picture: [],
      }),
    );
    const cleared = await outputBytes(clearedPlan.parts);
    const clearedInspection = await Effect.runPromise(
      opusDriver.inspect(makeBlobByteSource(new Blob([cleared]))),
    );
    expect(clearedInspection.metadata).toMatchObject({
      title: "",
      genre: "",
      trackNumber: null,
      discNumber: null,
      bpm: null,
      picture: [],
    });
    expect(new TextDecoder().decode(cleared)).toContain("X-private=opaque value");
    expect(containsBytes(cleared, trailing)).toBe(true);
    expect(
      fixturePages(cleared)
        .slice(-audioBodies.length)
        .map((page) => page.body),
    ).toEqual(audioBodies);
  });

  it("repaginates growing tags and updates downstream sequences and checksums", async () => {
    const audioBodies = [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5, 6, 7)];
    const original = validOpusBytes({ comments: ["TITLE=small"], audioBodies });
    expect(fixturePages(original).map((page) => page.sequence)).toEqual([0, 1, 2, 3]);

    const plan = await Effect.runPromise(
      opusDriver.patch(makeBlobByteSource(new Blob([original])), {
        title: "x".repeat(70_000),
      }),
    );
    const patched = await outputBytes(plan.parts);
    const pages = fixturePages(patched);

    expect(pages.map((page) => page.sequence)).toEqual([0, 1, 2, 3, 4]);
    expect(pages[1]!.segments).toHaveLength(255);
    expect(pages[1]!.segments.every((length) => length === 255)).toBe(true);
    expect(pages[1]!.headerType & 1).toBe(0);
    expect(pages[2]!.headerType & 1).toBe(1);
    expect(pages[2]!.segments.at(-1)).toBeLessThan(255);
    expect(pages.slice(-2).map((page) => page.body)).toEqual(audioBodies);
    for (const page of pages) {
      expect(opusFixtureCrc(page.bytes, true)).toBe(readLe32(page.bytes, 22));
    }
    const inspected = await Effect.runPromise(
      opusDriver.inspect(makeBlobByteSource(new Blob([patched]))),
    );
    expect(inspected.metadata.title).toBe("x".repeat(70_000));
  });

  it("returns typed errors for truncation, invalid pictures, and tag framing", async () => {
    const truncated = validOpusBytes().slice(0, -1);
    await expect(
      Effect.runPromise(
        opusDriver.patch(makeBlobByteSource(new Blob([truncated])), {
          title: "changed",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "AudioMetadataWriteError" });

    const invalidPicture = validOpusBytes({
      comments: ["METADATA_BLOCK_PICTURE=not base64"],
    });
    await expect(
      Effect.runPromise(opusDriver.inspect(makeBlobByteSource(new Blob([invalidPicture])))),
    ).rejects.toMatchObject({ _tag: "AudioMetadataReadError" });

    const head = opusHeadPacket();
    const tags = opusTagsPacket(["TITLE=bad framing"]);
    const serial = 0x5566_7788;
    const badFraming = concatOpusFixtureBytes(
      opusOggPage({
        body: head,
        segments: Uint8Array.of(head.length),
        serial,
        sequence: 0,
        headerType: 2,
      }),
      opusOggPage({
        body: concatOpusFixtureBytes(tags, Uint8Array.of(1, 2, 3)),
        segments: Uint8Array.of(tags.length, 3),
        serial,
        sequence: 1,
      }),
      opusOggPage({
        body: Uint8Array.of(4, 5),
        segments: Uint8Array.of(2),
        serial,
        sequence: 2,
        headerType: 4,
        granulePosition: 96_312n,
      }),
    );
    await expect(
      Effect.runPromise(opusDriver.inspect(makeBlobByteSource(new Blob([badFraming])))),
    ).rejects.toMatchObject({ _tag: "AudioMetadataReadError" });

    const oversizedFamilyOne = opusHeadPacket(312, {
      channels: 9,
      family: 1,
      streams: 5,
      coupled: 4,
      indices: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    });
    await expect(
      Effect.runPromise(
        opusDriver.inspect(
          makeBlobByteSource(new Blob([validOpusBytes({ head: oversizedFamilyOne })])),
        ),
      ),
    ).rejects.toMatchObject({ _tag: "AudioMetadataReadError" });
  });

  it("rejects grouped logical streams and excessive picture writes", async () => {
    const groupedPage = opusOggPage({
      body: Uint8Array.of(1),
      segments: Uint8Array.of(1),
      serial: 0xaabb_ccdd,
      sequence: 0,
      headerType: 2 | 4,
    });
    const grouped = concatOpusFixtureBytes(validOpusBytes(), groupedPage);
    await expect(
      Effect.runPromise(opusDriver.inspect(makeBlobByteSource(new Blob([grouped])))),
    ).rejects.toMatchObject({ _tag: "AudioMetadataReadError" });

    const tooManyPictures = Array.from({ length: 257 }, () => ({
      format: "image/png",
      type: 3,
      description: "",
      data: Uint8Array.of(1),
    }));
    await expect(
      Effect.runPromise(
        opusDriver.patch(makeBlobByteSource(new Blob([validOpusBytes()])), {
          picture: tooManyPictures,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "AudioMetadataWriteError" });
  });
});
