import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { AudioMetadataReadError } from "@/features/audio/audioErrors";
import type { ByteSource } from "@/features/audio/metadataEngine/byteSource";
import { makeBlobByteSource } from "@/features/audio/metadataEngine/byteSource";
import { mp4Driver } from "@/features/audio/metadataEngine/mp4";

const u32 = (value: number) =>
  Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
const u16 = (value: number) => Uint8Array.of((value >>> 8) & 0xff, value & 0xff);
const concat = (...chunks: Uint8Array[]) => {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};
const ascii = (value: string) => Uint8Array.from(value, (character) => character.charCodeAt(0));
const atom = (type: string, ...payload: Uint8Array[]) => {
  const body = concat(...payload);
  return concat(u32(body.length + 8), ascii(type), body);
};
const data = (value: Uint8Array, type = 1) => atom("data", u32(type), u32(0), value);
const textItem = (type: string, value: string) => atom(type, data(new TextEncoder().encode(value)));
const pictureItem = (...pictures: { bytes: number[]; type: number }[]) =>
  atom("covr", ...pictures.map((picture) => data(Uint8Array.from(picture.bytes), picture.type)));

interface FixtureOptions {
  codec?: "mp4a" | "alac" | "enca";
  title?: string;
  secondMdat?: boolean;
  artworkSize?: number;
  offsetKind?: "stco" | "co64";
  externalReference?: boolean;
  binaryFreeform?: boolean;
}

const makeFixture = ({
  codec = "mp4a",
  title = "Old",
  secondMdat = true,
  artworkSize = 3,
  offsetKind = "stco",
  externalReference = false,
  binaryFreeform = false,
}: FixtureOptions = {}) => {
  const ftyp = atom("ftyp", ascii("M4A "), u32(0), ascii("isomM4A "));
  const media1 = Uint8Array.from({ length: 37 }, (_, index) => (index * 17 + 3) & 0xff);
  const media2 = Uint8Array.from({ length: 29 }, (_, index) => (index * 11 + 9) & 0xff);
  const mdat1 = atom("mdat", media1);
  const mdat2 = atom("mdat", media2);
  const free = atom("free", ascii("top-level-opaque"));

  const makeMoov = (offsets: number[]) => {
    const sampleEntry = concat(
      u32(44),
      ascii(codec),
      new Uint8Array(6),
      u16(1),
      new Uint8Array(8),
      u16(2),
      u16(16),
      u16(0),
      u16(0),
      u32(44_100 * 65_536),
      atom("zzzz"),
    );
    const stsd = atom("stsd", u32(0), u32(1), sampleEntry);
    const chunkOffsets = atom(
      offsetKind,
      u32(0),
      u32(offsets.length),
      ...offsets.map((offset) =>
        offsetKind === "co64" ? concat(u32(0), u32(offset)) : u32(offset),
      ),
    );
    const stbl = atom("stbl", stsd, atom("zzzz", ascii("opaque-stbl")), chunkOffsets);
    const dataInformation = externalReference
      ? atom("dinf", atom("dref", u32(0), u32(1), atom("url ", u32(0), ascii("external"))))
      : new Uint8Array();
    const minf = atom("minf", dataInformation, stbl);
    const mdhd = atom("mdhd", u32(0), u32(0), u32(0), u32(44_100), u32(88_200), u16(0), u16(0));
    const hdlr = atom("hdlr", u32(0), u32(0), ascii("soun"), new Uint8Array(12), Uint8Array.of(0));
    const trak = atom("trak", atom("mdia", mdhd, hdlr, minf));
    const unknownItem = atom("Xtra", data(ascii("opaque-ilst"), 0));
    const freeform = atom(
      "----",
      atom("mean", u32(0), ascii("com.apple.iTunes")),
      atom("name", u32(0), ascii("TITLE")),
      data(ascii("Fallback title")),
    );
    const opaqueFreeform = atom(
      "----",
      atom("mean", u32(0), ascii("vendor.example")),
      atom("name", u32(0), ascii("BINARY_PRIVATE")),
      data(Uint8Array.of(0xff, 0xfe, 0x00), 0),
    );
    const ilst = atom(
      "ilst",
      textItem("©nam", title),
      textItem("©ART", "Artist"),
      textItem("©alb", "Album"),
      textItem("©day", "2024-07-19"),
      textItem("©gen", "Rock"),
      textItem("©gen", "Pop"),
      atom("trkn", data(concat(u16(0), u16(7), u16(12), u16(0)), 0)),
      pictureItem(
        {
          bytes: Array.from({ length: artworkSize }, (_, index) =>
            index === 0 ? 0xff : index & 0xff,
          ),
          type: 13,
        },
        { bytes: [0x89, 0x50, 2], type: 14 },
      ),
      unknownItem,
      freeform,
      ...(binaryFreeform ? [opaqueFreeform] : []),
    );
    const meta = atom(
      "meta",
      u32(0),
      atom("hdlr", u32(0), u32(0), ascii("mdir"), new Uint8Array(12)),
      ilst,
    );
    return atom("moov", trak, atom("udta", meta), atom("uuid", ascii("unknown-moov-atom")));
  };

  let moov = makeMoov(secondMdat ? [0, 0] : [0]);
  const firstOffset = ftyp.length + moov.length + 8;
  const secondOffset = ftyp.length + moov.length + mdat1.length + free.length + 8;
  moov = makeMoov(secondMdat ? [firstOffset, secondOffset] : [firstOffset]);
  const bytes = concat(ftyp, moov, mdat1, ...(secondMdat ? [free, mdat2] : []));
  return {
    bytes,
    media: secondMdat ? [media1, media2] : [media1],
    opaque: [ascii("opaque-stbl"), ascii("opaque-ilst"), ascii("unknown-moov-atom")],
  };
};

const runInspect = (bytes: Uint8Array<ArrayBuffer>) =>
  Effect.runPromise(mp4Driver.inspect(makeBlobByteSource(new Blob([bytes]))));
const runPatch = async (
  bytes: Uint8Array<ArrayBuffer>,
  changes: Parameters<typeof mp4Driver.patch>[1],
) => {
  const plan = await Effect.runPromise(
    mp4Driver.patch(makeBlobByteSource(new Blob([bytes])), changes),
  );
  return new Uint8Array(await new Blob(plan.parts, { type: plan.type }).arrayBuffer());
};

const includes = (haystack: Uint8Array, needle: Uint8Array) => {
  outer: for (let index = 0; index <= haystack.length - needle.length; index++) {
    for (let inner = 0; inner < needle.length; inner++)
      if (haystack[index + inner] !== needle[inner]) continue outer;
    return true;
  }
  return false;
};

const topAtoms = (bytes: Uint8Array) => {
  const result: { type: string; start: number; size: number }[] = [];
  for (let offset = 0; offset < bytes.length; ) {
    const size =
      bytes[offset]! * 0x1000000 +
      bytes[offset + 1]! * 0x10000 +
      bytes[offset + 2]! * 0x100 +
      bytes[offset + 3]!;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    result.push({ type, start: offset, size });
    offset += size;
  }
  return result;
};

describe("mp4Driver", () => {
  it("inspects AAC metadata with direct ilst precedence, multiple values, and bounded reads", async () => {
    const fixture = makeFixture();
    const blob = new Blob([fixture.bytes]);
    let largestRead = 0;
    const source: ByteSource = {
      size: blob.size,
      slice: (start, end) => blob.slice(start, end),
      read: (offset, length) => {
        largestRead = Math.max(largestRead, length);
        if (length > 256)
          return Effect.fail(
            new AudioMetadataReadError({ message: "oversized", cause: undefined }),
          );
        return Effect.promise(
          async () => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
        );
      },
    };
    const result = await Effect.runPromise(mp4Driver.inspect(source));
    expect(result.metadata).toMatchObject({
      title: "Old",
      artist: "Artist",
      album: "Album",
      year: 2024,
      genre: ["Rock", "Pop"],
      trackNumber: 7,
      trackTotal: 12,
      duration: 2,
      sampleRate: 44_100,
    });
    expect(result.metadata.picture.map((picture) => picture.format)).toEqual([
      "image/jpeg",
      "image/png",
    ]);
    expect(largestRead).toBeLessThanOrEqual(256);
  });

  it("returns a byte-identical source for an empty patch", async () => {
    const { bytes } = makeFixture();
    expect(await runPatch(bytes, {})).toEqual(bytes);
  });

  it("keeps unknown binary freeform metadata opaque", async () => {
    const { bytes } = makeFixture({ binaryFreeform: true });
    await expect(runInspect(bytes)).resolves.toMatchObject({ metadata: { title: "Old" } });
    const output = await runPatch(bytes, { title: "Changed" });
    expect(Array.from(output).join(",")).toContain("255,254,0");
  });

  it("chunks artwork reads instead of requesting the complete metadata payload", async () => {
    const fixture = makeFixture({ artworkSize: 1024 * 1024 + 17 });
    const blob = new Blob([fixture.bytes]);
    let largestRead = 0;
    const source: ByteSource = {
      size: blob.size,
      slice: (start, end) => blob.slice(start, end),
      read: (offset, length) => {
        largestRead = Math.max(largestRead, length);
        if (length > 1024 * 1024) {
          return Effect.fail(
            new AudioMetadataReadError({ message: "oversized", cause: undefined }),
          );
        }
        return Effect.promise(
          async () => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
        );
      },
    };
    const result = await Effect.runPromise(mp4Driver.inspect(source));
    expect(result.metadata.picture[0]?.data).toHaveLength(1024 * 1024 + 17);
    expect(largestRead).toBeLessThanOrEqual(1024 * 1024);
  });

  it("patches text without changing media bytes, opaque atoms, or artwork multiplicity", async () => {
    const fixture = makeFixture();
    const output = await runPatch(fixture.bytes, { title: "A much longer replacement title" });
    const inspected = await runInspect(output);
    expect(inspected.metadata.title).toBe("A much longer replacement title");
    expect(inspected.metadata.picture).toHaveLength(2);
    for (const opaque of fixture.opaque) expect(includes(output, opaque)).toBe(true);
    const outputMdats = topAtoms(output).filter((entry) => entry.type === "mdat");
    expect(outputMdats).toHaveLength(2);
    expect(
      outputMdats.map((entry) => output.slice(entry.start + 8, entry.start + entry.size)),
    ).toEqual(fixture.media);
  });

  it("updates every moved stco offset across multiple mdat regions", async () => {
    const fixture = makeFixture();
    const output = await runPatch(fixture.bytes, {
      album: "An album name long enough to move both media atoms",
    });
    const mdats = topAtoms(output).filter((entry) => entry.type === "mdat");
    for (const mdat of mdats) {
      const encoded = u32(mdat.start + 8);
      expect(includes(output, encoded)).toBe(true);
    }
  });

  it("updates co64 offsets without narrowing the table", async () => {
    const fixture = makeFixture({ offsetKind: "co64" });
    const output = await runPatch(fixture.bytes, { artist: "A longer artist value" });
    const mdat = topAtoms(output).find((entry) => entry.type === "mdat")!;
    expect(includes(output, concat(u32(0), u32(mdat.start + 8)))).toBe(true);
    expect(includes(output, ascii("co64"))).toBe(true);
  });

  it("replaces artwork only when explicitly edited", async () => {
    const fixture = makeFixture();
    const output = await runPatch(fixture.bytes, {
      picture: [
        { format: "image/png", type: 3, description: "front", data: Uint8Array.of(7, 8, 9) },
      ],
    });
    const inspected = await runInspect(output);
    expect(inspected.metadata.picture).toHaveLength(1);
    expect(inspected.metadata.picture[0]?.data).toEqual(Uint8Array.of(7, 8, 9));
  });

  it("supports ALAC and rejects encrypted, malformed, and truncated containers", async () => {
    await expect(runInspect(makeFixture({ codec: "alac" }).bytes)).resolves.toMatchObject({
      format: { kind: "m4a" },
    });
    await expect(runInspect(makeFixture({ codec: "enca" }).bytes)).rejects.toMatchObject({
      _tag: "AudioMetadataReadError",
      message: expect.stringContaining("encrypted"),
    });
    await expect(runInspect(ascii("not an mp4 file"))).rejects.toMatchObject({
      _tag: "AudioMetadataReadError",
    });
    const truncated = makeFixture().bytes.slice(0, -3);
    await expect(runInspect(truncated)).rejects.toMatchObject({ _tag: "AudioMetadataReadError" });
  });

  it("rejects fragmented and external-reference layouts before patch planning", async () => {
    const fragmented = concat(makeFixture().bytes, atom("moof", atom("traf", new Uint8Array())));
    await expect(runInspect(fragmented)).rejects.toThrow("fragmented MP4");
    await expect(runInspect(makeFixture({ externalReference: true }).bytes)).rejects.toThrow(
      "external media data references",
    );
  });
});
