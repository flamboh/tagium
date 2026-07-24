import { createHash } from "node:crypto";
import { Effect } from "effect";
import { makeBlobByteSource } from "../../../src/features/audio/metadataEngine/byteSource";
import { flacDriver } from "../../../src/features/audio/metadataEngine/flac";
import { mp3Driver } from "../../../src/features/audio/metadataEngine/mp3/mp3Driver";
import { mp4Driver } from "../../../src/features/audio/metadataEngine/mp4";

export type FixtureFamily = "mp3" | "flac" | "m4a";

const ascii = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: readonly Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};
const u24be = (value: number) =>
  Uint8Array.of((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
const u32be = (value: number) =>
  Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
const readU24be = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! * 0x1_0000 + bytes[offset + 1]! * 0x100 + bytes[offset + 2]!;
const readU32be = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! * 0x1_000000 +
  bytes[offset + 1]! * 0x1_0000 +
  bytes[offset + 2]! * 0x100 +
  bytes[offset + 3]!;
const atom = (type: string, ...parts: readonly Uint8Array[]) => {
  const payload = concat(...parts);
  return concat(u32be(payload.length + 8), ascii(type), payload);
};

const mp3Fixture = () => {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  return concat(frame, frame);
};

const flacFixture = () => {
  const streamInfo = new Uint8Array(34);
  streamInfo.set([0x10, 0x00, 0x10, 0x00]);
  const packed = (44_100n << 44n) | (1n << 41n) | (15n << 36n) | 88_200n;
  for (let index = 0; index < 8; index++) {
    streamInfo[10 + index] = Number((packed >> BigInt((7 - index) * 8)) & 0xffn);
  }
  return concat(
    ascii("fLaC"),
    Uint8Array.of(0x80),
    u24be(streamInfo.length),
    streamInfo,
    Uint8Array.of(0xff, 0xf8, 0x69, 0x18),
    new Uint8Array(124),
  );
};

const mp4Fixture = () => {
  const mdhd = atom(
    "mdhd",
    u32be(0),
    u32be(0),
    u32be(0),
    u32be(44_100),
    u32be(88_200),
    new Uint8Array(4),
  );
  const hdlr = atom("hdlr", u32be(0), u32be(0), ascii("soun"), new Uint8Array(12));
  const sampleEntry = new Uint8Array(28);
  sampleEntry.set([0, 1], 6);
  sampleEntry.set([0, 2, 0, 16], 16);
  sampleEntry.set(u32be(44_100 * 0x1_0000), 24);
  const stsd = atom("stsd", u32be(0), u32be(1), atom("alac", sampleEntry));
  const track = atom("trak", atom("mdia", mdhd, hdlr, atom("minf", atom("stbl", stsd))));
  const payload = Uint8Array.from({ length: 256 }, (_, index) => (index * 17 + 1) & 0xff);
  return concat(
    atom("ftyp", ascii("M4A "), u32be(0), ascii("M4A "), ascii("isom")),
    atom("moov", track),
    atom("mdat", payload),
  );
};

const drivers = { mp3: mp3Driver, flac: flacDriver, m4a: mp4Driver } as const;
const fixtures = { mp3: mp3Fixture, flac: flacFixture, m4a: mp4Fixture } as const;

export const materializeFixture = async (family: FixtureFamily) => {
  const plan = await Effect.runPromise(
    drivers[family].patch(makeBlobByteSource(new Blob([fixtures[family]()])), {
      title: "Plain title",
      artist: "Artist 1",
      album: "Synthetic Album 1",
      year: 1981,
      genre: "Test",
      trackNumber: 2,
    }),
  );
  return new Uint8Array(await new Blob(plan.parts, { type: plan.type }).arrayBuffer());
};

const mp3Payload = (bytes: Uint8Array) => {
  if (bytes.length < 10 || new TextDecoder("latin1").decode(bytes.subarray(0, 3)) !== "ID3") {
    return bytes;
  }
  const size = (bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!;
  const footer = bytes[3] === 4 && (bytes[5]! & 0x10) !== 0 ? 10 : 0;
  return bytes.slice(10 + size + footer);
};

const flacPayload = (bytes: Uint8Array) => {
  let offset = 4;
  let last = false;
  while (!last) {
    last = (bytes[offset]! & 0x80) !== 0;
    offset += 4 + readU24be(bytes, offset + 1);
  }
  return bytes.slice(offset);
};

const mp4Payload = (bytes: Uint8Array) => {
  const payloads: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; ) {
    const size = readU32be(bytes, offset) || bytes.length - offset;
    if (new TextDecoder("latin1").decode(bytes.subarray(offset + 4, offset + 8)) === "mdat") {
      payloads.push(bytes.slice(offset + 8, offset + size));
    }
    offset += size;
  }
  return concat(...payloads);
};

export const audioPayloadSha256 = (family: FixtureFamily, bytes: Uint8Array) => {
  const payload =
    family === "mp3"
      ? mp3Payload(bytes)
      : family === "flac"
        ? flacPayload(bytes)
        : mp4Payload(bytes);
  return createHash("sha256").update(payload).digest("hex");
};
