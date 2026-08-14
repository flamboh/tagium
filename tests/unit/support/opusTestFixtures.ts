const encoder = new TextEncoder();
const CRC_POLYNOMIAL = 0x04c1_1db7;

export const concatOpusFixtureBytes = (...parts: Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

const le16 = (value: number) => Uint8Array.of(value, value >>> 8);
const le32 = (value: number) =>
  Uint8Array.of(value, value >>> 8, value >>> 16, value >>> 24).map((byte) => byte & 0xff);
const be32 = (value: number) =>
  Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value).map((byte) => byte & 0xff);

const writeLe32 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes.set(le32(value), offset);
};

const writeLe64 = (bytes: Uint8Array, offset: number, value: bigint) => {
  let remaining = value < 0 ? 0xffff_ffff_ffff_ffffn : value;
  for (let index = 0; index < 8; index++) {
    bytes[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
};

export const opusFixtureCrc = (bytes: Uint8Array, clearStoredChecksum = false) => {
  let crc = 0;
  for (let index = 0; index < bytes.length; index++) {
    const byte = clearStoredChecksum && index >= 22 && index < 26 ? 0 : bytes[index]!;
    crc = (crc ^ (byte << 24)) >>> 0;
    for (let bit = 0; bit < 8; bit++) {
      crc = ((crc & 0x8000_0000) !== 0 ? (crc << 1) ^ CRC_POLYNOMIAL : crc << 1) >>> 0;
    }
  }
  return crc;
};

export const opusOggPage = ({
  body,
  segments,
  serial = 0x1122_3344,
  sequence,
  headerType = 0,
  granulePosition = 0n,
}: {
  body: Uint8Array;
  segments: Uint8Array;
  serial?: number;
  sequence: number;
  headerType?: number;
  granulePosition?: bigint;
}) => {
  const page = new Uint8Array(27 + segments.length + body.length);
  page.set(encoder.encode("OggS"));
  page[5] = headerType;
  writeLe64(page, 6, granulePosition);
  writeLe32(page, 14, serial);
  writeLe32(page, 18, sequence);
  page[26] = segments.length;
  page.set(segments, 27);
  page.set(body, 27 + segments.length);
  writeLe32(page, 22, opusFixtureCrc(page));
  return page;
};

export const opusHeadPacket = (
  preSkip = 312,
  mapping: {
    readonly channels: number;
    readonly family: number;
    readonly streams: number;
    readonly coupled: number;
    readonly indices: readonly number[];
  } = { channels: 2, family: 0, streams: 0, coupled: 0, indices: [] },
) =>
  concatOpusFixtureBytes(
    encoder.encode("OpusHead"),
    Uint8Array.of(1, mapping.channels),
    le16(preSkip),
    le32(48_000),
    le16(0),
    Uint8Array.of(mapping.family),
    ...(mapping.family === 0
      ? []
      : [Uint8Array.of(mapping.streams, mapping.coupled, ...mapping.indices)]),
  );

export const opusTagsPacket = (
  comments: readonly string[],
  trailing: Uint8Array = new Uint8Array(),
  vendor = "tagium fixture",
) => {
  const vendorBytes = encoder.encode(vendor);
  const commentBytes = comments.map((comment) => encoder.encode(comment));
  return concatOpusFixtureBytes(
    encoder.encode("OpusTags"),
    le32(vendorBytes.length),
    vendorBytes,
    le32(commentBytes.length),
    ...commentBytes.flatMap((comment) => [le32(comment.length), comment]),
    trailing,
  );
};

export const opusPictureBlock = ({
  type = 3,
  format = "image/png",
  description = "front",
  data = Uint8Array.of(1, 2, 3),
}: {
  type?: number;
  format?: string;
  description?: string;
  data?: Uint8Array;
} = {}) => {
  const mime = encoder.encode(format);
  const descriptionBytes = encoder.encode(description);
  return concatOpusFixtureBytes(
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
    data,
  );
};

export const opusFixtureBase64 = (bytes: Uint8Array) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]!;
    const hasSecond = offset + 1 < bytes.length;
    const hasThird = offset + 2 < bytes.length;
    const second = hasSecond ? bytes[offset + 1]! : 0;
    const third = hasThird ? bytes[offset + 2]! : 0;
    output += alphabet[first >>> 2];
    output += alphabet[((first & 3) << 4) | (second >>> 4)];
    output += hasSecond ? alphabet[((second & 15) << 2) | (third >>> 6)] : "=";
    output += hasThird ? alphabet[third & 63] : "=";
  }
  return output;
};

export const paginateOpusFixturePacket = ({
  packet,
  serial = 0x1122_3344,
  firstSequence,
  maxSegments = 255,
}: {
  packet: Uint8Array;
  serial?: number;
  firstSequence: number;
  maxSegments?: number;
}) => {
  const lacing: number[] = [];
  let remaining = packet.length;
  while (remaining >= 255) {
    lacing.push(255);
    remaining -= 255;
  }
  lacing.push(remaining);
  const pages: Uint8Array[] = [];
  let laceOffset = 0;
  let bodyOffset = 0;
  while (laceOffset < lacing.length) {
    const pageLacing = lacing.slice(laceOffset, laceOffset + maxSegments);
    const bodyLength = pageLacing.reduce((total, length) => total + length, 0);
    const final = laceOffset + pageLacing.length === lacing.length;
    pages.push(
      opusOggPage({
        body: packet.slice(bodyOffset, bodyOffset + bodyLength),
        segments: Uint8Array.from(pageLacing),
        serial,
        sequence: firstSequence + pages.length,
        headerType: pages.length === 0 ? 0 : 1,
        granulePosition: final ? 0n : -1n,
      }),
    );
    laceOffset += pageLacing.length;
    bodyOffset += bodyLength;
  }
  return pages;
};

export interface ValidOpusFixtureOptions {
  readonly comments?: readonly string[];
  readonly trailing?: Uint8Array;
  readonly vendor?: string;
  readonly preSkip?: number;
  readonly head?: Uint8Array;
  readonly serial?: number;
  readonly audioBodies?: readonly Uint8Array[];
  readonly finalGranule?: bigint;
  readonly tagMaxSegments?: number;
}

export const validOpusBytes = ({
  comments = ["TITLE=fixture title", "ARTIST=fixture artist"],
  trailing = Uint8Array.of(0xde, 0xad, 0xbe, 0xef),
  vendor = "tagium fixture",
  preSkip = 312,
  head = opusHeadPacket(preSkip),
  serial = 0x1122_3344,
  audioBodies = [Uint8Array.of(0xf8, 0xff, 0xfe), Uint8Array.of(0xf8, 0xff, 0xfe, 1)],
  finalGranule = BigInt(preSkip + 96_000),
  tagMaxSegments = 255,
}: ValidOpusFixtureOptions = {}) => {
  const headPage = opusOggPage({
    body: head,
    segments: Uint8Array.of(head.length),
    serial,
    sequence: 0,
    headerType: 2,
    granulePosition: 0n,
  });
  const tagPages = paginateOpusFixturePacket({
    packet: opusTagsPacket(comments, trailing, vendor),
    serial,
    firstSequence: 1,
    maxSegments: tagMaxSegments,
  });
  const audioPages = audioBodies.map((body, index) =>
    opusOggPage({
      body,
      segments: Uint8Array.of(body.length),
      serial,
      sequence: 1 + tagPages.length + index,
      headerType: index === audioBodies.length - 1 ? 4 : 0,
      granulePosition:
        index === audioBodies.length - 1
          ? finalGranule
          : BigInt(preSkip + Math.floor((96_000 * (index + 1)) / audioBodies.length)),
    }),
  );
  return concatOpusFixtureBytes(headPage, ...tagPages, ...audioPages);
};
