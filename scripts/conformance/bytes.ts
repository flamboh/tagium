import { createHash } from "node:crypto";

export const ascii = (value: string) => new TextEncoder().encode(value);

export const concat = (...parts: readonly Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

export const u24be = (value: number) =>
  Uint8Array.of((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);

export const u32be = (value: number) =>
  Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);

export const u32le = (value: number) =>
  Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);

export const synchsafe = (value: number) =>
  Uint8Array.of((value >>> 21) & 0x7f, (value >>> 14) & 0x7f, (value >>> 7) & 0x7f, value & 0x7f);

export const readU24be = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! * 0x1_0000 + bytes[offset + 1]! * 0x100 + bytes[offset + 2]!;

export const readU32be = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! * 0x1_000000 +
  bytes[offset + 1]! * 0x1_0000 +
  bytes[offset + 2]! * 0x100 +
  bytes[offset + 3]!;

export const readU32le = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! +
  bytes[offset + 1]! * 0x100 +
  bytes[offset + 2]! * 0x1_0000 +
  bytes[offset + 3]! * 0x1_000000;

export const readSynchsafe = (bytes: Uint8Array, offset: number) =>
  (bytes[offset]! << 21) |
  (bytes[offset + 1]! << 14) |
  (bytes[offset + 2]! << 7) |
  bytes[offset + 3]!;

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export const textAt = (bytes: Uint8Array, offset: number, length: number) =>
  new TextDecoder("latin1").decode(bytes.subarray(offset, offset + length));

export const xorshift32 = (initial: number) => {
  let state = initial >>> 0 || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
};
