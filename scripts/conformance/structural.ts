import { concat, readSynchsafe, readU24be, readU32be, readU32le, sha256, textAt } from "./bytes";
import type { FixtureFamily } from "./types";

export class StructuralError extends Error {}

const mp3Payload = (bytes: Uint8Array) => {
  let start = 0;
  if (bytes.length >= 10 && textAt(bytes, 0, 3) === "ID3") {
    const version = bytes[3];
    if (version !== 2 && version !== 3 && version !== 4)
      throw new StructuralError("unsupported ID3 version");
    if ([bytes[6], bytes[7], bytes[8], bytes[9]].some((value) => (value! & 0x80) !== 0)) {
      throw new StructuralError("invalid ID3 size");
    }
    start = 10 + readSynchsafe(bytes, 6) + (version === 4 && (bytes[5]! & 0x10) !== 0 ? 10 : 0);
    if (start > bytes.length) throw new StructuralError("truncated ID3 tag");
  }
  let end = bytes.length;
  if (end >= 128 && textAt(bytes, end - 128, 3) === "TAG") end -= 128;
  if (end >= 32 && textAt(bytes, end - 32, 8) === "APETAGEX") {
    const size = readU32le(bytes, end - 20);
    if (size < 32 || size > end - start) throw new StructuralError("invalid APEv2 size");
    end -= size;
  }
  if (end <= start || bytes[start] !== 0xff || (bytes[start + 1]! & 0xe0) !== 0xe0) {
    throw new StructuralError("missing MPEG frame sync");
  }
  return bytes.slice(start, end);
};

const flacPayload = (bytes: Uint8Array) => {
  if (bytes.length < 42 || textAt(bytes, 0, 4) !== "fLaC")
    throw new StructuralError("missing FLAC marker");
  let offset = 4;
  let last = false;
  let blocks = 0;
  while (!last) {
    if (offset + 4 > bytes.length) throw new StructuralError("truncated FLAC metadata header");
    last = (bytes[offset]! & 0x80) !== 0;
    const type = bytes[offset]! & 0x7f;
    if (type === 127) throw new StructuralError("forbidden FLAC block");
    const length = readU24be(bytes, offset + 1);
    if (blocks === 0 && (type !== 0 || length !== 34))
      throw new StructuralError("invalid STREAMINFO");
    offset += 4 + length;
    if (offset > bytes.length) throw new StructuralError("truncated FLAC metadata block");
    blocks++;
    if (blocks > 1024) throw new StructuralError("too many FLAC metadata blocks");
  }
  if (offset + 2 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1]! & 0xfc) !== 0xf8) {
    throw new StructuralError("missing FLAC frame sync");
  }
  return bytes.slice(offset);
};

const mp4Payload = (bytes: Uint8Array) => {
  const payloads: Uint8Array[] = [];
  let offset = 0;
  let sawFtyp = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new StructuralError("truncated MP4 atom header");
    let size = readU32be(bytes, offset);
    const type = textAt(bytes, offset + 4, 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > bytes.length) throw new StructuralError("truncated extended MP4 atom");
      const high = readU32be(bytes, offset + 8);
      const low = readU32be(bytes, offset + 12);
      size = high * 0x1_0000_0000 + low;
      header = 16;
    } else if (size === 0) {
      size = bytes.length - offset;
    }
    if (size < header || !Number.isSafeInteger(size) || offset + size > bytes.length) {
      throw new StructuralError(`invalid MP4 ${type} atom size`);
    }
    if (type === "ftyp") sawFtyp = true;
    if (type === "mdat") payloads.push(bytes.slice(offset + header, offset + size));
    offset += size;
  }
  if (!sawFtyp || payloads.length === 0) throw new StructuralError("MP4 requires ftyp and mdat");
  return concat(...payloads);
};

export const extractAudioPayload = (family: FixtureFamily, bytes: Uint8Array) => {
  if (family === "mp3") return mp3Payload(bytes);
  if (family === "flac") return flacPayload(bytes);
  return mp4Payload(bytes);
};

export const audioPayloadSha256 = (family: FixtureFamily, bytes: Uint8Array) =>
  sha256(extractAudioPayload(family, bytes));
