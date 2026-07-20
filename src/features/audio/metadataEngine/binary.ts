export const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

export const asciiBytes = (value: string) => Uint8Array.from(value, (value) => value.charCodeAt(0));

export const concatBytes = (...chunks: Uint8Array[]) => {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};
export const readUint24BE = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! * 0x10000 + bytes[offset + 1]! * 0x100 + bytes[offset + 2]!;

export const readUint32BE = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! * 0x1000000 +
  bytes[offset + 1]! * 0x10000 +
  bytes[offset + 2]! * 0x100 +
  bytes[offset + 3]!;

export const readUint32LE = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! +
  bytes[offset + 1]! * 0x100 +
  bytes[offset + 2]! * 0x10000 +
  bytes[offset + 3]! * 0x1000000;

export const uint24BE = (value: number) =>
  Uint8Array.of((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);

export const uint32BE = (value: number) =>
  Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);

export const uint32LE = (value: number) =>
  Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);

export const synchsafeToNumber = (bytes: Uint8Array, offset: number) =>
  (bytes[offset]! << 21) |
  (bytes[offset + 1]! << 14) |
  (bytes[offset + 2]! << 7) |
  bytes[offset + 3]!;

export const numberToSynchsafe = (value: number) =>
  Uint8Array.of((value >>> 21) & 0x7f, (value >>> 14) & 0x7f, (value >>> 7) & 0x7f, value & 0x7f);

export const bytesEqual = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};
