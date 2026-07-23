import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { numberToSynchsafe } from "@/features/audio/metadataEngine/binary";
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
