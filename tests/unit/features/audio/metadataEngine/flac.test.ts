import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { makeBlobByteSource, type ByteSource } from "@/features/audio/metadataEngine/byteSource";
import { flacDriver } from "@/features/audio/metadataEngine/flac";

const concat = (...parts: Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};
const be32 = (value: number) =>
  Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value).map((byte) => byte & 0xff);
const le32 = (value: number) =>
  Uint8Array.of(value, value >>> 8, value >>> 16, value >>> 24).map((byte) => byte & 0xff);
const utf8 = (value: string) => new TextEncoder().encode(value);

const block = (type: number, payload: Uint8Array, last = false) =>
  concat(
    Uint8Array.of(
      type | (last ? 0x80 : 0),
      (payload.length >>> 16) & 0xff,
      (payload.length >>> 8) & 0xff,
      payload.length & 0xff,
    ),
    payload,
  );

const streamInfo = (sampleRate = 48_000, totalSamples = 96_000) => {
  const bytes = new Uint8Array(34);
  bytes[10] = sampleRate >>> 12;
  bytes[11] = sampleRate >>> 4;
  bytes[12] = ((sampleRate & 0x0f) << 4) | 0x04;
  bytes[13] = 0x10 | Math.floor(totalSamples / 0x1_0000_0000);
  bytes.set(be32(totalSamples), 14);
  return bytes;
};

const vorbis = (comments: string[], vendor = "fixture-vendor") => {
  const encoded = comments.map(utf8);
  const vendorBytes = utf8(vendor);
  return concat(
    le32(vendorBytes.length),
    vendorBytes,
    le32(encoded.length),
    ...encoded.flatMap((comment) => [le32(comment.length), comment]),
  );
};

const picture = (type: number, description: string, data: number[]) => {
  const mime = utf8("image/png");
  const descriptionBytes = utf8(description);
  return concat(
    be32(type),
    be32(mime.length),
    mime,
    be32(descriptionBytes.length),
    descriptionBytes,
    be32(1),
    be32(1),
    be32(24),
    be32(0),
    be32(data.length),
    Uint8Array.from(data),
  );
};

const audio = Uint8Array.of(0xff, 0xf8, 0x69, 0x00, 1, 2, 3, 4, 5, 6);
const unknown = Uint8Array.of(0xde, 0xad, 0xbe, 0xef);
const fixture = () =>
  concat(
    utf8("fLaC"),
    block(0, streamInfo()),
    block(
      4,
      vorbis([
        "TITLE=first title",
        "TITLE=duplicate title",
        "ARTIST=Artist",
        "ALBUM=Album",
        "DATE=2024-03-01",
        "GENRE=Electronic",
        "GENRE=Ambient",
        "TRACKNUMBER=3/12",
        "REPLAYGAIN_TRACK_GAIN=-7.1 dB",
        "X-private=opaque value",
      ]),
    ),
    block(6, picture(3, "front", [1, 2, 3])),
    block(2, unknown),
    block(6, picture(4, "back", [4, 5, 6]), true),
    audio,
  );

const outputBytes = async (parts: BlobPart[]) =>
  new Uint8Array(await new Blob(parts).arrayBuffer());

const audioOffset = (bytes: Uint8Array) => {
  let offset = 4;
  let last = false;
  while (!last) {
    last = (bytes[offset]! & 0x80) !== 0;
    const length = bytes[offset + 1]! * 0x10000 + bytes[offset + 2]! * 0x100 + bytes[offset + 3]!;
    offset += 4 + length;
  }
  return offset;
};

describe("FLAC metadata driver", () => {
  it("reads stream facts, first-value comment precedence, genres, and every picture", async () => {
    const bytes = fixture();
    const seenReads: number[] = [];
    const source = makeBlobByteSource(new Blob([bytes]));
    const instrumented: ByteSource = {
      ...source,
      read: (offset, length) => {
        seenReads.push(length);
        if (length > 8 * 1024 * 1024) throw new Error("oversized read");
        return source.read(offset, length);
      },
    };

    const result = await Effect.runPromise(flacDriver.inspect(instrumented));

    expect(result.format.kind).toBe("flac");
    expect(result.metadata).toMatchObject({
      title: "first title",
      artist: "Artist",
      album: "Album",
      year: 2024,
      genre: ["Electronic", "Ambient"],
      duration: 2,
      sampleRate: 48_000,
      trackNumber: 3,
      trackTotal: 12,
    });
    expect(
      result.metadata.picture.map(({ type, description, data }) => ({
        type,
        description,
        data: [...data],
      })),
    ).toEqual([
      { type: 3, description: "front", data: [1, 2, 3] },
      { type: 4, description: "back", data: [4, 5, 6] },
    ]);
    expect(Math.max(...seenReads)).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it("returns the entire original source for a no-op patch", async () => {
    const original = fixture();
    const plan = await Effect.runPromise(
      flacDriver.patch(makeBlobByteSource(new Blob([original])), {}),
    );
    expect(await outputBytes(plan.parts)).toEqual(original);
    expect(plan.parts).toHaveLength(1);
  });

  it("patches owned comments while preserving unknown blocks, comments, pictures, and audio", async () => {
    const original = fixture();
    const source = makeBlobByteSource(new Blob([original]));
    const plan = await Effect.runPromise(flacDriver.patch(source, { title: "Changed 🦊" }));
    const patched = await outputBytes(plan.parts);
    const result = await Effect.runPromise(
      flacDriver.inspect(makeBlobByteSource(new Blob([patched]))),
    );

    expect(result.metadata.title).toBe("Changed 🦊");
    expect(result.metadata.picture.map((entry) => [...entry.data])).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect([...patched.subarray(audioOffset(patched))]).toEqual([
      ...original.subarray(audioOffset(original)),
    ]);
    expect(new TextDecoder().decode(patched)).toContain("REPLAYGAIN_TRACK_GAIN=-7.1 dB");
    expect(new TextDecoder().decode(patched)).toContain("X-private=opaque value");
    expect([...patched]).toEqual(expect.arrayContaining([...unknown]));
  });

  it("only replaces pictures when an explicit picture change is present", async () => {
    const original = fixture();
    const source = makeBlobByteSource(new Blob([original]));
    const plan = await Effect.runPromise(
      flacDriver.patch(source, {
        picture: [{ format: "image/jpeg", type: 3, description: "new", data: Uint8Array.of(9, 8) }],
      }),
    );
    const patched = await outputBytes(plan.parts);
    const result = await Effect.runPromise(
      flacDriver.inspect(makeBlobByteSource(new Blob([patched]))),
    );

    expect(result.metadata.picture).toHaveLength(1);
    expect(result.metadata.picture[0]).toMatchObject({
      format: "image/jpeg",
      type: 3,
      description: "new",
      data: Uint8Array.of(9, 8),
    });
    expect([...patched.subarray(audioOffset(patched))]).toEqual([...audio]);
  });

  it("returns typed errors for malformed and truncated streams without producing output", async () => {
    const invalid = concat(utf8("fLaC"), block(0, streamInfo(), true), Uint8Array.of(0, 0));
    await expect(
      Effect.runPromise(flacDriver.inspect(makeBlobByteSource(new Blob([invalid])))),
    ).rejects.toMatchObject({ _tag: "AudioMetadataReadError" });

    const truncated = fixture().slice(0, 50);
    await expect(
      Effect.runPromise(
        flacDriver.patch(makeBlobByteSource(new Blob([truncated])), { title: "x" }),
      ),
    ).rejects.toMatchObject({ _tag: "AudioMetadataWriteError" });
  });
});
