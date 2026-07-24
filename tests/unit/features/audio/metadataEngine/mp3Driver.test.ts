import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { numberToSynchsafe, readUint32LE, uint32LE } from "@/features/audio/metadataEngine/binary";
import { makeBlobByteSource } from "@/features/audio/metadataEngine/byteSource";
import { mp3Driver } from "@/features/audio/metadataEngine/mp3/mp3Driver";
import { validMp3Bytes } from "../../../support/mp3TestFixtures";

const encoder = new TextEncoder();
const concat = (...chunks: Uint8Array[]) => {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};
const frame = (id: string, value: string) => {
  const payload = concat(Uint8Array.of(3), encoder.encode(value));
  const size = Uint8Array.of(0, 0, 0, payload.length);
  return concat(encoder.encode(id), size, Uint8Array.of(0, 0), payload);
};
const rawFrame = (id: string, payload: Uint8Array) =>
  concat(encoder.encode(id), Uint8Array.of(0, 0, 0, payload.length), Uint8Array.of(0, 0), payload);
const commentFrame = (description: string, value: string, language = "eng") =>
  rawFrame(
    "COMM",
    concat(
      Uint8Array.of(3),
      encoder.encode(language),
      encoder.encode(description),
      Uint8Array.of(0),
      encoder.encode(value),
    ),
  );
const apeItem = (key: string, value: string | Uint8Array, flags = 0) => {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return concat(
    uint32LE(bytes.length),
    uint32LE(flags),
    encoder.encode(key),
    Uint8Array.of(0),
    bytes,
  );
};
const apeTag = (...items: Uint8Array[]) => {
  const footer = new Uint8Array(32);
  footer.set(encoder.encode("APETAGEX"));
  footer.set(uint32LE(2_000), 8);
  footer.set(uint32LE(items.reduce((size, item) => size + item.length, 32)), 12);
  footer.set(uint32LE(items.length), 16);
  return concat(...items, footer);
};
const apeTagWithHeader = (...items: Uint8Array[]) => {
  const size = items.reduce((total, item) => total + item.length, 32);
  const header = new Uint8Array(32);
  header.set(encoder.encode("APETAGEX"));
  header.set(uint32LE(2_000), 8);
  header.set(uint32LE(size), 12);
  header.set(uint32LE(items.length), 16);
  header.set(uint32LE(0xa000_0000), 20);
  const footer = header.slice();
  footer.set(uint32LE(0x8000_0000), 20);
  return concat(header, ...items, footer);
};
const includes = (haystack: Uint8Array, needle: Uint8Array) => {
  outer: for (let index = 0; index <= haystack.length - needle.length; index++) {
    for (let inner = 0; inner < needle.length; inner++) {
      if (haystack[index + inner] !== needle[inner]) continue outer;
    }
    return true;
  }
  return false;
};
const tag = (...frames: Uint8Array[]) => {
  const body = concat(...frames);
  return concat(
    encoder.encode("ID3"),
    Uint8Array.of(4, 0, 0),
    numberToSynchsafe(body.length),
    body,
  );
};
const frameV22 = (id: string, value: string) => {
  const payload = concat(Uint8Array.of(0), encoder.encode(value));
  return concat(
    encoder.encode(id),
    Uint8Array.of(
      (payload.length >>> 16) & 0xff,
      (payload.length >>> 8) & 0xff,
      payload.length & 0xff,
    ),
    payload,
  );
};
const frameV23 = (id: string, value: string) =>
  rawFrame(id, concat(Uint8Array.of(0), encoder.encode(value)));
const tagV22 = (...frames: Uint8Array[]) => {
  const body = concat(...frames);
  return concat(
    encoder.encode("ID3"),
    Uint8Array.of(2, 0, 0),
    numberToSynchsafe(body.length),
    body,
  );
};
const tagWithExtendedHeader = (
  version: 3 | 4,
  extendedHeader: Uint8Array,
  ...frames: Uint8Array[]
) => {
  const body = concat(extendedHeader, ...frames);
  return concat(
    encoder.encode("ID3"),
    Uint8Array.of(version, 0, 0x40),
    numberToSynchsafe(body.length),
    body,
  );
};

describe("mp3Driver", () => {
  it("returns the original byte source for a no-op", async () => {
    const input = concat(tag(frame("TIT2", "Title")), validMp3Bytes());
    const plan = await Effect.runPromise(
      mp3Driver.patch(makeBlobByteSource(new Blob([input])), {}),
    );
    expect(new Uint8Array(await new Blob(plan.parts).arrayBuffer())).toEqual(input);
  });

  it("patches owned frames while preserving unknown frames and every trailing byte", async () => {
    const unknown = rawFrame("PRIV", Uint8Array.of(9, 8, 7, 6));
    const trailing = concat(validMp3Bytes(), encoder.encode("APETAGEX-opaque-tail"));
    const input = concat(tag(frame("TIT2", "Before"), unknown), trailing);
    const source = makeBlobByteSource(new Blob([input]));
    const plan = await Effect.runPromise(mp3Driver.patch(source, { title: "After 😀" }));
    const output = new Uint8Array(await new Blob(plan.parts).arrayBuffer());
    expect(output.slice(-trailing.length)).toEqual(trailing);
    expect(Array.from(output).join(",")).toContain(Array.from(unknown).join(","));
    const inspected = await Effect.runPromise(
      mp3Driver.inspect(makeBlobByteSource(new Blob([output]))),
    );
    expect(inspected.metadata.title).toBe("After 😀");
  });

  it("derives technical fields without browser codec playback", async () => {
    const inspected = await Effect.runPromise(
      mp3Driver.inspect(makeBlobByteSource(new Blob([validMp3Bytes()]))),
    );
    expect(inspected.metadata).toMatchObject({ bitrate: 128_000, sampleRate: 44_100 });
    expect(inspected.metadata.albumArtist).toBe("");
    expect(inspected.metadata.duration).toBeGreaterThan(0);
  });

  it("projects and preserves the track total when editing the track number", async () => {
    const input = concat(tag(frame("TRCK", "3/12")), validMp3Bytes());
    const source = makeBlobByteSource(new Blob([input]));
    const inspected = await Effect.runPromise(mp3Driver.inspect(source));
    expect(inspected.metadata).toMatchObject({ trackNumber: 3, trackTotal: 12 });

    const plan = await Effect.runPromise(mp3Driver.patch(source, { trackNumber: 4 }));
    const output = new Blob(plan.parts);
    const updated = await Effect.runPromise(mp3Driver.inspect(makeBlobByteSource(output)));
    expect(updated.metadata).toMatchObject({ trackNumber: 4, trackTotal: 12 });
  });

  it("inspects, patches, and clears advanced fields without touching audio or alternate comments", async () => {
    const unknown = rawFrame("PRIV", Uint8Array.of(9, 8, 7, 6));
    const alternateComment = commentFrame("archive", "Keep alternate");
    const audio = validMp3Bytes();
    const input = concat(
      tag(
        frame("TPE2", "Album Artist"),
        frame("TCOM", "Composer"),
        frame("TPOS", "2/3"),
        frame("TBPM", "128"),
        commentFrame("", "Primary comment"),
        alternateComment,
        unknown,
      ),
      audio,
    );
    const source = makeBlobByteSource(new Blob([input]));

    const inspected = await Effect.runPromise(mp3Driver.inspect(source));
    expect(inspected.metadata).toMatchObject({
      albumArtist: "Album Artist",
      composer: "Composer",
      comment: "Primary comment",
      discNumber: 2,
      bpm: 128,
    });

    const patchedPlan = await Effect.runPromise(
      mp3Driver.patch(source, {
        albumArtist: "New Album Artist",
        composer: "New Composer",
        comment: "New primary",
        discNumber: 1,
        bpm: 140,
      }),
    );
    const patched = new Uint8Array(await new Blob(patchedPlan.parts).arrayBuffer());
    expect(patched.slice(-audio.length)).toEqual(audio);
    expect(Array.from(patched).join(",")).toContain(Array.from(unknown).join(","));
    expect(Array.from(patched).join(",")).toContain(Array.from(alternateComment).join(","));
    const updated = await Effect.runPromise(
      mp3Driver.inspect(makeBlobByteSource(new Blob([patched]))),
    );
    expect(updated.metadata).toMatchObject({
      albumArtist: "New Album Artist",
      composer: "New Composer",
      comment: "New primary",
      discNumber: 1,
      bpm: 140,
    });
    expect(new TextDecoder("latin1").decode(patched)).toContain("1/3");

    const clearedPlan = await Effect.runPromise(
      mp3Driver.patch(makeBlobByteSource(new Blob([patched])), {
        albumArtist: "",
        composer: "",
        comment: "",
        discNumber: null,
        bpm: null,
      }),
    );
    const cleared = new Uint8Array(await new Blob(clearedPlan.parts).arrayBuffer());
    const clearedInspection = await Effect.runPromise(
      mp3Driver.inspect(makeBlobByteSource(new Blob([cleared]))),
    );
    expect(clearedInspection.metadata).toMatchObject({
      albumArtist: "",
      composer: "",
      comment: "",
      discNumber: null,
      bpm: null,
    });
    expect(Array.from(cleared).join(",")).toContain(Array.from(alternateComment).join(","));
    expect(cleared.slice(-audio.length)).toEqual(audio);
  });

  it("updates and clears APEv2-only advanced fields without losing unknown items or audio", async () => {
    const audio = validMp3Bytes();
    const unknown = apeItem("X-PRIVATE", Uint8Array.of(0xff, 0, 0x7f), 2);
    const input = concat(
      audio,
      apeTag(
        apeItem("AlbumArtist", "APE Album Artist"),
        apeItem("Composer", "APE Composer"),
        apeItem("Comment", "APE comment"),
        apeItem("DiscNumber", "2/3"),
        apeItem("BPM", "128"),
        unknown,
      ),
    );
    const source = makeBlobByteSource(new Blob([input]));
    const inspected = await Effect.runPromise(mp3Driver.inspect(source));
    expect(inspected.metadata).toMatchObject({
      albumArtist: "APE Album Artist",
      composer: "APE Composer",
      comment: "APE comment",
      discNumber: 2,
      bpm: 128,
    });

    const patchedPlan = await Effect.runPromise(
      mp3Driver.patch(source, {
        albumArtist: "New Album Artist",
        composer: "New Composer",
        comment: "New comment",
        discNumber: 1,
        bpm: 140,
      }),
    );
    const patched = new Uint8Array(await new Blob(patchedPlan.parts).arrayBuffer());
    expect(includes(patched, audio)).toBe(true);
    expect(includes(patched, unknown)).toBe(true);
    expect(new TextDecoder("latin1").decode(patched)).toContain("1/3");
    const updated = await Effect.runPromise(
      mp3Driver.inspect(makeBlobByteSource(new Blob([patched]))),
    );
    expect(updated.metadata).toMatchObject({
      albumArtist: "New Album Artist",
      composer: "New Composer",
      comment: "New comment",
      discNumber: 1,
      bpm: 140,
    });

    const clearedPlan = await Effect.runPromise(
      mp3Driver.patch(makeBlobByteSource(new Blob([patched])), {
        albumArtist: "",
        composer: "",
        comment: "",
        discNumber: null,
        bpm: null,
      }),
    );
    const cleared = new Uint8Array(await new Blob(clearedPlan.parts).arrayBuffer());
    expect(includes(cleared, audio)).toBe(true);
    expect(includes(cleared, unknown)).toBe(true);
    const clearedInspection = await Effect.runPromise(
      mp3Driver.inspect(makeBlobByteSource(new Blob([cleared]))),
    );
    expect(clearedInspection.metadata).toMatchObject({
      albumArtist: "",
      composer: "",
      comment: "",
      discNumber: null,
      bpm: null,
    });
  });

  it("rewrites an optional APEv2 header and footer with matching size and count", async () => {
    const audio = validMp3Bytes();
    const unknown = apeItem("Binary", Uint8Array.of(9, 8, 7), 2);
    const input = concat(audio, apeTagWithHeader(apeItem("Composer", "Before"), unknown));
    const plan = await Effect.runPromise(
      mp3Driver.patch(makeBlobByteSource(new Blob([input])), { composer: "After" }),
    );
    const output = new Uint8Array(await new Blob(plan.parts).arrayBuffer());
    expect(includes(output, audio)).toBe(true);
    expect(includes(output, unknown)).toBe(true);

    const signatures = Array.from(output.keys()).filter(
      (offset) =>
        offset + 8 <= output.length &&
        new TextDecoder("latin1").decode(output.subarray(offset, offset + 8)) === "APETAGEX",
    );
    expect(signatures).toHaveLength(2);
    const [headerOffset, footerOffset] = signatures;
    expect(readUint32LE(output, headerOffset! + 12)).toBe(readUint32LE(output, footerOffset! + 12));
    expect(readUint32LE(output, headerOffset! + 16)).toBe(2);
    expect(readUint32LE(output, footerOffset! + 16)).toBe(2);
    expect(footerOffset! + 32 - readUint32LE(output, footerOffset! + 12)).toBe(headerOffset! + 32);
    const inspected = await Effect.runPromise(
      mp3Driver.inspect(makeBlobByteSource(new Blob([output]))),
    );
    expect(inspected.metadata.composer).toBe("After");
  });

  it("removes an optional APEv2 header and footer when all owned entries are cleared", async () => {
    const audio = validMp3Bytes();
    const input = concat(audio, apeTagWithHeader(apeItem("Composer", "Before")));
    const plan = await Effect.runPromise(
      mp3Driver.patch(makeBlobByteSource(new Blob([input])), { composer: "" }),
    );
    const output = new Uint8Array(await new Blob(plan.parts).arrayBuffer());
    expect(output).toEqual(concat(tag(), audio));
    expect(new TextDecoder("latin1").decode(output)).not.toContain("APETAGEX");
  });

  it("clears owned entries from headered APEv2 while preserving unknown items and audio", async () => {
    const audio = validMp3Bytes();
    const unknown = apeItem("Binary", Uint8Array.of(9, 8, 7), 2);
    const input = concat(audio, apeTagWithHeader(apeItem("Composer", "Before"), unknown));
    const plan = await Effect.runPromise(
      mp3Driver.patch(makeBlobByteSource(new Blob([input])), { composer: "" }),
    );
    const output = new Uint8Array(await new Blob(plan.parts).arrayBuffer());
    expect(includes(output, audio)).toBe(true);
    expect(includes(output, unknown)).toBe(true);
    const signatures = new TextDecoder("latin1").decode(output).match(/APETAGEX/gu);
    expect(signatures).toHaveLength(2);
    const inspected = await Effect.runPromise(
      mp3Driver.inspect(makeBlobByteSource(new Blob([output]))),
    );
    expect(inspected.metadata.composer).toBe("");
  });

  it("preserves localized blank-description comments while replacing only English primary", async () => {
    const localized = commentFrame("", "Comentario", "spa");
    const input = concat(tag(commentFrame("", "Primary"), localized), validMp3Bytes());
    const patchedPlan = await Effect.runPromise(
      mp3Driver.patch(makeBlobByteSource(new Blob([input])), { comment: "Updated" }),
    );
    const patched = new Uint8Array(await new Blob(patchedPlan.parts).arrayBuffer());
    expect(includes(patched, localized)).toBe(true);
    const inspected = await Effect.runPromise(
      mp3Driver.inspect(makeBlobByteSource(new Blob([patched]))),
    );
    expect(inspected.metadata.comment).toBe("Updated");

    const clearedPlan = await Effect.runPromise(
      mp3Driver.patch(makeBlobByteSource(new Blob([patched])), { comment: "" }),
    );
    const cleared = new Uint8Array(await new Blob(clearedPlan.parts).arrayBuffer());
    expect(includes(cleared, localized)).toBe(true);
    const clearedInspection = await Effect.runPromise(
      mp3Driver.inspect(makeBlobByteSource(new Blob([cleared]))),
    );
    expect(clearedInspection.metadata.comment).toBe("");
  });

  it.each([
    ["disc", frame("TPOS", "2x"), { discNumber: null }],
    ["BPM", frame("TBPM", "128 BPM"), { bpm: null }],
  ])("rejects malformed complete %s grammar", async (_field, malformed, expected) => {
    const inspected = await Effect.runPromise(
      mp3Driver.inspect(makeBlobByteSource(new Blob([tag(malformed), validMp3Bytes()]))),
    );
    expect(inspected.metadata).toMatchObject(expected);
  });

  it("rejects malformed advanced numeric suffixes from APEv2 fallbacks", async () => {
    const inspected = await Effect.runPromise(
      mp3Driver.inspect(
        makeBlobByteSource(
          new Blob([validMp3Bytes(), apeTag(apeItem("Disc", "2x"), apeItem("BPM", "128 BPM"))]),
        ),
      ),
    );
    expect(inspected.metadata).toMatchObject({ discNumber: null, bpm: null });
  });

  it("round-trips ID3v2.4 multi-value genres and writes Cobalt extension fields", async () => {
    const source = makeBlobByteSource(new Blob([validMp3Bytes()]));
    const plan = await Effect.runPromise(
      mp3Driver.patch(source, {
        genre: ["Rock", "Pop"],
        dateText: "2024-07-19",
        trackText: "3/12",
        albumArtist: "Album Artist",
        composer: "Composer",
        copyright: "Copyright",
        language: "eng",
      }),
    );
    const output = new Uint8Array(await new Blob(plan.parts).arrayBuffer());
    const inspected = await Effect.runPromise(
      mp3Driver.inspect(makeBlobByteSource(new Blob([output]))),
    );
    expect(inspected.metadata).toMatchObject({
      year: 2024,
      genre: ["Rock", "Pop"],
      trackNumber: 3,
      trackTotal: 12,
    });
    const encoded = new TextDecoder("latin1").decode(output);
    for (const frameId of ["TPE2", "TCOM", "TCOP", "TLAN"]) expect(encoded).toContain(frameId);
  });

  it("uses three-byte frame identifiers when editing ID3v2.2 dates", async () => {
    const source = makeBlobByteSource(
      new Blob([tagV22(frameV22("TT2", "Before"), frameV22("TYE", "1999")), validMp3Bytes()]),
    );
    const plan = await Effect.runPromise(
      mp3Driver.patch(source, { title: "After", artist: "Artist", year: 2032 }),
    );
    const output = new Blob(plan.parts);
    const inspected = await Effect.runPromise(mp3Driver.inspect(makeBlobByteSource(output)));
    expect(inspected.metadata).toMatchObject({ title: "After", artist: "Artist", year: 2032 });
  });

  it.each([
    [
      "ID3v2.3",
      tagWithExtendedHeader(
        3,
        concat(Uint8Array.of(0, 0, 0, 100), new Uint8Array(6)),
        frame("TIT2", "Title"),
      ),
    ],
    [
      "ID3v2.4",
      tagWithExtendedHeader(
        4,
        concat(Uint8Array.of(0, 0, 0, 127), Uint8Array.of(1, 0)),
        frame("TIT2", "Title"),
      ),
    ],
  ])(
    "rejects malformed declared %s extended-header sizes on inspect and patch",
    async (_version, tagBytes) => {
      const input = concat(tagBytes, validMp3Bytes());
      const source = makeBlobByteSource(new Blob([input]));
      await expect(Effect.runPromise(mp3Driver.inspect(source))).rejects.toThrow(
        /extended header/iu,
      );
      await expect(
        Effect.runPromise(mp3Driver.patch(source, { title: "Updated" })),
      ).rejects.toThrow(/extended header/iu);
    },
  );

  it("accepts valid ID3v2.3 and ID3v2.4 extended headers", async () => {
    const v23 = concat(Uint8Array.of(0, 0, 0, 6), new Uint8Array(6));
    const v24 = concat(numberToSynchsafe(6), Uint8Array.of(1, 0));
    const v24Crc = concat(numberToSynchsafe(12), Uint8Array.of(1, 0x20, 5, 0, 0, 0, 0, 0));
    const v24Restrictions = concat(numberToSynchsafe(8), Uint8Array.of(1, 0x10, 1, 0));
    for (const input of [
      concat(tagWithExtendedHeader(3, v23, frameV23("TIT2", "Title")), validMp3Bytes()),
      concat(tagWithExtendedHeader(4, v24, frame("TIT2", "Title")), validMp3Bytes()),
      concat(tagWithExtendedHeader(4, v24Crc, frame("TIT2", "Title")), validMp3Bytes()),
      concat(tagWithExtendedHeader(4, v24Restrictions, frame("TIT2", "Title")), validMp3Bytes()),
    ]) {
      const inspected = await Effect.runPromise(
        mp3Driver.inspect(makeBlobByteSource(new Blob([input]))),
      );
      expect(inspected.metadata.title).toBe("Title");
      await Effect.runPromise(
        mp3Driver.patch(makeBlobByteSource(new Blob([input])), { title: "Updated" }),
      );
    }
  });

  it("rejects ID3v2.4 extended headers with malformed flag-data lengths", async () => {
    const malformedCrc = concat(numberToSynchsafe(12), Uint8Array.of(1, 0x20, 4, 0, 0, 0, 0, 0));
    const input = concat(
      tagWithExtendedHeader(4, malformedCrc, frame("TIT2", "Title")),
      validMp3Bytes(),
    );
    const source = makeBlobByteSource(new Blob([input]));
    await expect(Effect.runPromise(mp3Driver.inspect(source))).rejects.toThrow(/CRC length/iu);
    await expect(Effect.runPromise(mp3Driver.patch(source, { title: "Updated" }))).rejects.toThrow(
      /CRC length/iu,
    );
  });

  it("rejects headerless mixed-bitrate VBR instead of reporting a false duration", async () => {
    const first = new Uint8Array(417);
    first.set([0xff, 0xfb, 0x90, 0x64]);
    const second = new Uint8Array(522);
    second.set([0xff, 0xfb, 0xa0, 0x64]);
    await expect(
      Effect.runPromise(mp3Driver.inspect(makeBlobByteSource(new Blob([first, second])))),
    ).rejects.toThrow("VBR MP3 is missing a Xing/Info or VBRI frame count.");
  });

  it("rejects a malformed declared APEv2 tag", async () => {
    const footer = new Uint8Array(32);
    footer.set(encoder.encode("APETAGEX"));
    footer.set([0xd0, 0x07], 8);
    footer.set([16, 0, 0, 0], 12);
    await expect(
      Effect.runPromise(mp3Driver.inspect(makeBlobByteSource(new Blob([validMp3Bytes(), footer])))),
    ).rejects.toThrow("APEv2 footer declares an invalid size or item count.");
  });
});
