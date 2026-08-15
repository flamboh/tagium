import { Effect } from "effect";
import { makeBlobByteSource } from "@/features/audio/metadataEngine/byteSource";
import { mp4Driver } from "@/features/audio/metadataEngine/mp4";

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
const u32be = (value: number) =>
  Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
const atom = (type: string, ...parts: readonly Uint8Array[]) => {
  const payload = concat(...parts);
  return concat(u32be(payload.length + 8), ascii(type), payload);
};

const m4aFixture = () => {
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
  return concat(
    atom("ftyp", ascii("M4A "), u32be(0), ascii("M4A "), ascii("isom")),
    atom("moov", track),
    atom("mdat", new Uint8Array(256)),
  );
};

export const validM4aBytes = async () => {
  const plan = await Effect.runPromise(
    mp4Driver.patch(makeBlobByteSource(new Blob([m4aFixture()])), { title: "Plain title" }),
  );
  return new Uint8Array(await new Blob(plan.parts, { type: plan.type }).arrayBuffer());
};
