import { Effect } from "effect";
import { AudioMetadataReadError, AudioMetadataWriteError } from "@/features/audio/audioErrors";
import {
  ascii,
  asciiBytes,
  concatBytes,
  readUint32BE,
  readUint32LE,
  uint32BE,
} from "@/features/audio/metadataEngine/binary";
import type { ByteSource } from "@/features/audio/metadataEngine/byteSource";
import {
  rejectUnsupportedMetadataChanges,
  type FormatDriver,
} from "@/features/audio/metadataEngine/driver";
import type {
  ArtworkEntry,
  AudioInspection,
  MetadataChanges,
  PatchPlan,
} from "@/features/audio/metadataEngine/types";

const format = { kind: "opus", extension: "opus", mime: "audio/ogg" } as const;
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();
const MAX_OGG_PAGES = 1_000_000;
const MAX_TAG_BYTES = 64 * 1024 * 1024;
const MAX_TAG_PAGES = 4_096;
const MAX_VORBIS_COMMENTS = 100_000;
const MAX_PICTURES = 256;
const MAX_PICTURE_BYTES = 32 * 1024 * 1024;
const OGG_CRC_POLYNOMIAL = 0x04c1_1db7;
const MAX_OGG_PAGE_BYTES = 27 + 255 + 255 * 255;
const MAX_OGG_PAGE_PREFIX_BYTES = 27 + 255;
const UINT32_MODULUS = 0x1_0000_0000;

interface OggPage {
  readonly index: number;
  readonly offset: number;
  readonly length: number;
  readonly headerType: number;
  readonly granulePosition: bigint;
  readonly serial: number;
  readonly sequence: number;
  readonly segments: Uint8Array<ArrayBuffer>;
  readonly bodyOffset: number;
  readonly bodyLength: number;
}

interface VorbisComment {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly key: string;
  readonly value: string;
}

interface OpusTags {
  readonly vendor: Uint8Array<ArrayBuffer>;
  readonly comments: VorbisComment[];
  readonly trailing: Uint8Array<ArrayBuffer>;
}

interface ParsedOpus {
  readonly pages: OggPage[];
  readonly serial: number;
  readonly preSkip: number;
  readonly tags: OpusTags;
  readonly tagPacket: Uint8Array<ArrayBuffer>;
  readonly tagPageIndexes: ReadonlySet<number>;
  readonly tagStartIndex: number;
  readonly tagStreamEndIndex: number;
  readonly streamPages: OggPage[];
}

interface ParsedOpusMetadata {
  readonly serial: number;
  readonly preSkip: number;
  readonly tags: OpusTags;
  readonly tagPacket: Uint8Array<ArrayBuffer>;
  readonly tagPageIndexes: ReadonlySet<number>;
  readonly tagStartIndex: number;
  readonly tagStreamEndIndex: number;
  readonly streamPages: OggPage[];
  readonly firstAudioPage: OggPage;
}

interface StreamState {
  readonly sequence: number;
  readonly continues: boolean;
  readonly ended: boolean;
}

const readFailure = (message: string, cause?: unknown) =>
  new AudioMetadataReadError({ message, cause });

const writeFailure = (message: string, cause?: unknown) =>
  new AudioMetadataWriteError({ message, cause });

const failRead = (message: string) => Effect.fail(readFailure(message));

const parseReadable = <A>(operation: () => A, context: string) =>
  Effect.try({
    try: operation,
    catch: (cause) =>
      cause instanceof AudioMetadataReadError
        ? cause
        : readFailure(`unable to parse ${context}.`, cause),
  });

const decodeUtf8 = (bytes: Uint8Array, context: string) => {
  try {
    return textDecoder.decode(bytes);
  } catch (cause) {
    throw readFailure(`Opus ${context} is not valid UTF-8.`, cause);
  }
};

const readUint64LE = (bytes: Uint8Array, offset: number) => {
  let value = 0n;
  for (let index = 7; index >= 0; index--) {
    value = (value << 8n) | BigInt(bytes[offset + index]!);
  }
  return value === 0xffff_ffff_ffff_ffffn ? -1n : value;
};

const writeUint32LE = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
};

const writeUint64LE = (bytes: Uint8Array, offset: number, value: bigint) => {
  let remaining = value < 0 ? 0xffff_ffff_ffff_ffffn : value;
  for (let index = 0; index < 8; index++) {
    bytes[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
};

const oggCrcTable = new Uint32Array(256);
for (let value = 0; value < oggCrcTable.length; value++) {
  let remainder = value << 24;
  for (let bit = 0; bit < 8; bit++) {
    remainder =
      (remainder & 0x8000_0000) !== 0 ? (remainder << 1) ^ OGG_CRC_POLYNOMIAL : remainder << 1;
  }
  oggCrcTable[value] = remainder >>> 0;
}

const oggCrc = (bytes: Uint8Array) => {
  let crc = 0;
  for (const byte of bytes) {
    const tableIndex = ((crc >>> 24) ^ byte) & 0xff;
    crc = ((crc << 8) ^ oggCrcTable[tableIndex]!) >>> 0;
  }
  return crc;
};

const pageContinues = (page: OggPage, previousContinues: boolean) =>
  page.segments.length === 0 ? previousContinues : page.segments[page.segments.length - 1] === 255;

const parseOggPagePrefix = (
  prefix: Uint8Array<ArrayBuffer>,
  offset: number,
  index: number,
  sourceSize: number,
) => {
  if (prefix.length < 27) throw readFailure("Ogg stream is truncated in a page header.");
  if (ascii(prefix, 0, 4) !== "OggS") {
    throw readFailure("Ogg page capture pattern is missing or corrupt.");
  }
  if (prefix[4] !== 0) throw readFailure("Ogg page uses an unsupported stream version.");
  const headerType = prefix[5]!;
  if ((headerType & ~0x07) !== 0) throw readFailure("Ogg page has invalid header flags.");
  const segmentCount = prefix[26]!;
  if (prefix.length < 27 + segmentCount) {
    throw readFailure("Ogg stream is truncated in a page segment table.");
  }
  const segments = prefix.slice(27, 27 + segmentCount);
  let bodyLength = 0;
  for (const length of segments) bodyLength += length;
  const length = 27 + segmentCount + bodyLength;
  if (offset + length > sourceSize) {
    throw readFailure("Ogg stream is truncated in a page body.");
  }
  return {
    index,
    offset,
    length,
    headerType,
    granulePosition: readUint64LE(prefix, 6),
    serial: readUint32LE(prefix, 14),
    sequence: readUint32LE(prefix, 18),
    segments,
    bodyOffset: offset + 27 + segmentCount,
    bodyLength,
  } satisfies OggPage;
};

const readOggPage = (source: ByteSource, offset: number, index: number) =>
  Effect.gen(function* () {
    if (offset < 0 || offset >= source.size) {
      return yield* failRead("Ogg stream is missing a required page.");
    }
    const prefix = yield* source.read(
      offset,
      Math.min(MAX_OGG_PAGE_PREFIX_BYTES, source.size - offset),
    );
    return yield* parseReadable(
      () => parseOggPagePrefix(prefix, offset, index, source.size),
      "Ogg page",
    );
  });

const validateStreamPage = (page: OggPage, previous: StreamState | undefined) => {
  const continued = (page.headerType & 0x01) !== 0;
  const beginning = (page.headerType & 0x02) !== 0;
  const ended = (page.headerType & 0x04) !== 0;
  if (!previous) {
    if (!beginning || continued || page.sequence !== 0) {
      throw readFailure("Ogg logical stream does not begin with a valid BOS page.");
    }
  } else {
    if (previous.ended) {
      throw readFailure("Ogg logical stream contains data after its EOS page.");
    }
    if (beginning) throw readFailure("Ogg logical stream contains a duplicate BOS page.");
    if (page.sequence !== (previous.sequence + 1) % UINT32_MODULUS) {
      throw readFailure("Ogg logical stream page sequence is discontinuous.");
    }
    if (continued !== previous.continues) {
      throw readFailure("Ogg packet continuation flags do not match page lacing.");
    }
  }
  const continues = pageContinues(page, previous?.continues ?? false);
  if (ended && continues) throw readFailure("Ogg EOS page ends with an incomplete packet.");
  return { sequence: page.sequence, continues, ended } satisfies StreamState;
};

const parsePages = (source: ByteSource) =>
  Effect.gen(function* () {
    if (source.size < 27) return yield* failRead("Opus file is truncated.");
    const pages: OggPage[] = [];
    const streams = new Map<number, StreamState>();
    let streamSerial: number | undefined;
    let offset = 0;
    while (offset < source.size) {
      if (pages.length >= MAX_OGG_PAGES) {
        return yield* failRead("Ogg page count exceeds the safety limit.");
      }
      const page = yield* readOggPage(source, offset, pages.length);
      const serial = page.serial;
      streamSerial ??= serial;
      if (serial !== streamSerial) {
        return yield* failRead("grouped or chained Ogg logical streams are not supported.");
      }
      const previous = streams.get(serial);
      const state = yield* parseReadable(
        () => validateStreamPage(page, previous),
        "Ogg page sequence",
      );
      streams.set(serial, state);
      pages.push(page);
      offset += page.length;
    }
    for (const state of streams.values()) {
      if (!state.ended) return yield* failRead("Ogg logical stream is missing its EOS page.");
    }
    return pages;
  });

const parseOpusHead = (bytes: Uint8Array<ArrayBuffer>) => {
  if (bytes.length < 19 || ascii(bytes, 0, 8) !== "OpusHead") {
    throw readFailure("Ogg stream does not begin with an OpusHead packet.");
  }
  const version = bytes[8]!;
  const channels = bytes[9]!;
  if (version > 15) throw readFailure("OpusHead uses an unsupported version.");
  if (channels === 0) throw readFailure("OpusHead declares zero channels.");
  const mappingFamily = bytes[18]!;
  if (version === 1 && mappingFamily === 0 && bytes.length !== 19) {
    throw readFailure("OpusHead has an invalid channel mapping length.");
  }
  if (mappingFamily === 0) {
    if (channels > 2) throw readFailure("OpusHead mapping family 0 has too many channels.");
  } else {
    if (mappingFamily === 1 && channels > 8) {
      throw readFailure("OpusHead mapping family 1 has too many channels.");
    }
    const mappingLength = 21 + channels;
    if (bytes.length < mappingLength || (version === 1 && bytes.length !== mappingLength)) {
      throw readFailure("OpusHead channel mapping is truncated or malformed.");
    }
    const streamCount = bytes[19]!;
    const coupledCount = bytes[20]!;
    if (streamCount === 0 || coupledCount > streamCount || streamCount + coupledCount > 255) {
      throw readFailure("OpusHead channel mapping stream counts are invalid.");
    }
    for (const mapping of bytes.subarray(21, mappingLength)) {
      if (mapping !== 255 && mapping >= streamCount + coupledCount) {
        throw readFailure("OpusHead contains an invalid channel mapping index.");
      }
    }
  }
  return bytes[10]! + bytes[11]! * 0x100;
};

const parseTags = (bytes: Uint8Array<ArrayBuffer>): OpusTags => {
  if (bytes.length < 16 || ascii(bytes, 0, 8) !== "OpusTags") {
    throw readFailure("OpusTags packet signature is missing or corrupt.");
  }
  let offset = 8;
  const takeLength = (context: string) => {
    if (offset + 4 > bytes.length) throw readFailure(`OpusTags ${context} is truncated.`);
    const length = readUint32LE(bytes, offset);
    offset += 4;
    if (offset + length > bytes.length) throw readFailure(`OpusTags ${context} is truncated.`);
    return length;
  };
  const vendorLength = takeLength("vendor");
  const vendor = bytes.slice(offset, offset + vendorLength);
  decodeUtf8(vendor, "vendor");
  offset += vendorLength;
  if (offset + 4 > bytes.length) throw readFailure("OpusTags comment count is truncated.");
  const count = readUint32LE(bytes, offset);
  offset += 4;
  if (count > MAX_VORBIS_COMMENTS) {
    throw readFailure("OpusTags comment count exceeds the safety limit.");
  }
  if (count > Math.floor((bytes.length - offset) / 4)) {
    throw readFailure("OpusTags comment count exceeds the packet size.");
  }
  const comments: VorbisComment[] = [];
  for (let index = 0; index < count; index++) {
    const length = takeLength("comment");
    const raw = bytes.slice(offset, offset + length);
    offset += length;
    const decoded = decodeUtf8(raw, "comment");
    const equals = decoded.indexOf("=");
    if (equals < 1 || !/^[\x20-\x3c\x3e-\x7d]+$/u.test(decoded.slice(0, equals))) {
      throw readFailure("OpusTags comment has an invalid field name.");
    }
    comments.push({
      bytes: raw,
      key: decoded.slice(0, equals),
      value: decoded.slice(equals + 1),
    });
  }
  return { vendor, comments, trailing: bytes.slice(offset) };
};

const readLeadingPages = (source: ByteSource) =>
  Effect.gen(function* () {
    if (source.size < 27) return yield* failRead("Opus file is truncated.");
    const pages: OggPage[] = [];
    let state: StreamState | undefined;
    let serial: number | undefined;
    let offset = 0;
    let tagsComplete = false;
    while (pages.length < MAX_TAG_PAGES + 2) {
      const page = yield* readOggPage(source, offset, pages.length);
      serial ??= page.serial;
      if (page.serial !== serial) {
        return yield* failRead("grouped or chained Ogg logical streams are not supported.");
      }
      state = yield* parseReadable(() => validateStreamPage(page, state), "Ogg page sequence");
      pages.push(page);
      offset += page.length;
      if (tagsComplete) return pages;
      if (pages.length > 1 && page.segments.some((length) => length < 255)) {
        tagsComplete = true;
      }
    }
    return yield* failRead("OpusTags page count exceeds the safety limit.");
  });

const findFinalPage = (source: ByteSource) =>
  Effect.gen(function* () {
    const tailLength = Math.min(MAX_OGG_PAGE_BYTES, source.size);
    const tailOffset = source.size - tailLength;
    const tail = yield* source.read(tailOffset, tailLength);
    for (let index = tail.length - 27; index >= 0; index--) {
      if (ascii(tail, index, 4) !== "OggS") continue;
      try {
        const page = parseOggPagePrefix(tail.slice(index), tailOffset + index, -1, source.size);
        if (page.offset + page.length === source.size) return page;
      } catch {
        // Audio packet bytes can contain a false OggS signature; keep searching backward.
      }
    }
    return yield* failRead("Ogg logical stream is missing its EOS page.");
  });

const parseMetadataStructure = (source: ByteSource, pages: OggPage[]) =>
  Effect.gen(function* () {
    const first = pages[0];
    if (!first) return yield* failRead("Opus file contains no Ogg pages.");
    if ((first.headerType & 0x02) === 0) {
      return yield* failRead("OpusHead is not on a BOS page.");
    }
    if (
      first.segments.length === 0 ||
      first.segments[first.segments.length - 1] === 255 ||
      first.segments.subarray(0, -1).some((length) => length !== 255)
    ) {
      return yield* failRead("OpusHead must be the only complete packet on its first page.");
    }
    if (first.granulePosition !== 0n) {
      return yield* failRead("OpusHead page has an invalid granule position.");
    }
    const head = yield* source.read(first.bodyOffset, first.bodyLength);
    const preSkip = yield* parseReadable(() => parseOpusHead(head), "OpusHead");
    const serial = first.serial;
    const streamPages = pages.filter((page) => page.serial === serial);
    if (streamPages.length < 3) {
      return yield* failRead("Opus stream is missing OpusTags or audio packets.");
    }
    const firstTagPage = streamPages[1]!;
    if ((firstTagPage.headerType & 0x01) !== 0) {
      return yield* failRead("OpusTags does not begin on a fresh Ogg page.");
    }

    const packetParts: Uint8Array<ArrayBuffer>[] = [];
    const tagPages: OggPage[] = [];
    let packetLength = 0;
    let tagStreamEndIndex = -1;
    for (let streamIndex = 1; streamIndex < streamPages.length; streamIndex++) {
      const page = streamPages[streamIndex]!;
      tagPages.push(page);
      if (tagPages.length > MAX_TAG_PAGES) {
        return yield* failRead("OpusTags page count exceeds the safety limit.");
      }
      packetLength += page.bodyLength;
      if (packetLength > MAX_TAG_BYTES) {
        return yield* failRead("OpusTags packet exceeds the 64 MiB safety limit.");
      }
      packetParts.push((yield* source.read(page.bodyOffset, page.bodyLength)).slice());
      const completionIndex = page.segments.findIndex((length) => length < 255);
      if (completionIndex >= 0) {
        if (completionIndex !== page.segments.length - 1) {
          return yield* failRead("OpusTags must end on its completion page.");
        }
        if (page.granulePosition !== 0n) {
          return yield* failRead("OpusTags completion page has an invalid granule position.");
        }
        tagStreamEndIndex = streamIndex;
        break;
      }
      if (page.granulePosition !== -1n) {
        return yield* failRead("Incomplete OpusTags page has an invalid granule position.");
      }
    }
    if (tagStreamEndIndex < 0) return yield* failRead("OpusTags packet is truncated.");
    if (tagStreamEndIndex + 1 >= streamPages.length) {
      return yield* failRead("Opus stream contains no audio packets.");
    }
    const tagPacket = new Uint8Array(packetLength);
    let packetOffset = 0;
    for (const part of packetParts) {
      tagPacket.set(part, packetOffset);
      packetOffset += part.length;
    }
    const tags = yield* parseReadable(() => parseTags(tagPacket), "OpusTags");
    return {
      serial,
      preSkip,
      tags,
      tagPacket,
      tagPageIndexes: new Set(tagPages.map((page) => page.index)),
      tagStartIndex: firstTagPage.index,
      tagStreamEndIndex,
      streamPages,
      firstAudioPage: streamPages[tagStreamEndIndex + 1]!,
    } satisfies ParsedOpusMetadata;
  });

const validateFinalPage = (page: OggPage, serial: number, preSkip: number) => {
  if (page.serial !== serial) {
    throw readFailure("grouped or chained Ogg logical streams are not supported.");
  }
  if (
    (page.headerType & 0x04) === 0 ||
    page.segments.at(-1) === 255 ||
    page.granulePosition < BigInt(preSkip)
  ) {
    throw readFailure("Opus EOS page has an invalid final granule position.");
  }
  if (page.granulePosition > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw readFailure("Opus duration exceeds the numeric safety limit.");
  }
};

const parseStructure = (source: ByteSource) =>
  Effect.gen(function* () {
    const pages = yield* parsePages(source);
    const metadata = yield* parseMetadataStructure(source, pages);
    const finalPage = metadata.streamPages[metadata.streamPages.length - 1]!;
    yield* parseReadable(
      () => validateFinalPage(finalPage, metadata.serial, metadata.preSkip),
      "Opus EOS page",
    );
    return { pages, ...metadata } satisfies ParsedOpus;
  });

const inspectStructure = (source: ByteSource) =>
  Effect.gen(function* () {
    const pages = yield* readLeadingPages(source);
    const metadata = yield* parseMetadataStructure(source, pages);
    const finalPage = yield* findFinalPage(source);
    yield* parseReadable(
      () => validateFinalPage(finalPage, metadata.serial, metadata.preSkip),
      "Opus EOS page",
    );
    return {
      preSkip: metadata.preSkip,
      tags: metadata.tags,
      finalGranule: finalPage.granulePosition,
      audioOffset: metadata.firstAudioPage.bodyOffset,
    };
  });

const firstValue = (comments: VorbisComment[], ...keys: string[]) => {
  const accepted = new Set(keys);
  return comments.find((comment) => accepted.has(comment.key.toUpperCase()))?.value;
};

const positiveInteger = (value: string | undefined) => {
  const head = value?.split("/", 1)[0]?.trim();
  if (!head || !/^\d+$/u.test(head)) return null;
  const number = Number(head);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const canonicalInteger = (value: string | undefined) => {
  const number = positiveInteger(value);
  return number !== null && number <= 999 ? number : null;
};

const yearValue = (value: string | undefined) => {
  const match = value?.match(/^\s*(\d{4})/u);
  return match ? Number(match[1]) : null;
};

const base64Value = (character: string) => {
  const code = character.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (character === "+") return 62;
  if (character === "/") return 63;
  return -1;
};

const decodeBase64 = (value: string) => {
  if (value.length === 0 || value.length % 4 !== 0) {
    throw readFailure("Opus METADATA_BLOCK_PICTURE is not valid base64.");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const outputLength = (value.length / 4) * 3 - padding;
  if (outputLength > MAX_PICTURE_BYTES) {
    throw readFailure("Opus picture exceeds the 32 MiB safety limit.");
  }
  const output = new Uint8Array(outputLength);
  let written = 0;
  for (let offset = 0; offset < value.length; offset += 4) {
    const final = offset + 4 === value.length;
    const first = base64Value(value[offset]!);
    const second = base64Value(value[offset + 1]!);
    const thirdCharacter = value[offset + 2]!;
    const fourthCharacter = value[offset + 3]!;
    const third = thirdCharacter === "=" ? 0 : base64Value(thirdCharacter);
    const fourth = fourthCharacter === "=" ? 0 : base64Value(fourthCharacter);
    if (
      first < 0 ||
      second < 0 ||
      third < 0 ||
      fourth < 0 ||
      (!final && (thirdCharacter === "=" || fourthCharacter === "=")) ||
      (thirdCharacter === "=" && fourthCharacter !== "=") ||
      (thirdCharacter === "=" && (second & 0x0f) !== 0) ||
      (fourthCharacter === "=" && thirdCharacter !== "=" && (third & 0x03) !== 0)
    ) {
      throw readFailure("Opus METADATA_BLOCK_PICTURE is not valid base64.");
    }
    if (written < output.length) output[written++] = (first << 2) | (second >>> 4);
    if (written < output.length) output[written++] = (second << 4) | (third >>> 2);
    if (written < output.length) output[written++] = (third << 6) | fourth;
  }
  return output;
};

const encodeBase64 = (bytes: Uint8Array) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const chunks: string[] = [];
  for (let chunkOffset = 0; chunkOffset < bytes.length; chunkOffset += 12 * 1024) {
    const end = Math.min(bytes.length, chunkOffset + 12 * 1024);
    let chunk = "";
    for (let offset = chunkOffset; offset < end; offset += 3) {
      const first = bytes[offset]!;
      const hasSecond = offset + 1 < bytes.length;
      const hasThird = offset + 2 < bytes.length;
      const second = hasSecond ? bytes[offset + 1]! : 0;
      const third = hasThird ? bytes[offset + 2]! : 0;
      chunk +=
        alphabet[first >>> 2]! +
        alphabet[((first & 3) << 4) | (second >>> 4)]! +
        (hasSecond ? alphabet[((second & 15) << 2) | (third >>> 6)]! : "=") +
        (hasThird ? alphabet[third & 63]! : "=");
    }
    chunks.push(chunk);
  }
  return chunks.join("");
};

const parsePicture = (bytes: Uint8Array<ArrayBuffer>): ArtworkEntry => {
  let offset = 0;
  const takeU32 = (context: string) => {
    if (offset + 4 > bytes.length) throw readFailure(`Opus picture ${context} is truncated.`);
    const value = readUint32BE(bytes, offset);
    offset += 4;
    return value;
  };
  const type = takeU32("type");
  const mimeLength = takeU32("MIME length");
  if (offset + mimeLength > bytes.length) throw readFailure("Opus picture MIME type is truncated.");
  const mime = decodeUtf8(bytes.subarray(offset, offset + mimeLength), "picture MIME type");
  offset += mimeLength;
  const descriptionLength = takeU32("description length");
  if (offset + descriptionLength > bytes.length) {
    throw readFailure("Opus picture description is truncated.");
  }
  const description = decodeUtf8(
    bytes.subarray(offset, offset + descriptionLength),
    "picture description",
  );
  offset += descriptionLength;
  const width = takeU32("width");
  const height = takeU32("height");
  const depth = takeU32("color depth");
  const colors = takeU32("indexed colors");
  const dataLength = takeU32("data length");
  if (dataLength > MAX_PICTURE_BYTES || offset + dataLength !== bytes.length) {
    throw readFailure("Opus picture data length does not match its block.");
  }
  return {
    format: mime,
    type,
    description,
    width,
    height,
    depth,
    colors,
    data: bytes.slice(offset),
    opaqueData: bytes.slice(),
  };
};

const encodePicture = (picture: ArtworkEntry) => {
  const mime = textEncoder.encode(picture.format);
  const description = textEncoder.encode(picture.description);
  return concatBytes(
    uint32BE(picture.type),
    uint32BE(mime.length),
    mime,
    uint32BE(description.length),
    description,
    uint32BE(picture.width ?? 0),
    uint32BE(picture.height ?? 0),
    uint32BE(picture.depth ?? 0),
    uint32BE(picture.colors ?? 0),
    uint32BE(picture.data.length),
    picture.data,
  );
};

const encodeComment = (key: string, value: string) => textEncoder.encode(`${key}=${value}`);

const encodeTags = (tags: OpusTags, changes: MetadataChanges) => {
  const replacements = new Map<string, Uint8Array<ArrayBuffer>[]>();
  const replaceText = (key: string, value: string | undefined) => {
    if (value === undefined) return;
    replacements.set(key, value.length > 0 ? [encodeComment(key, value)] : []);
  };
  replaceText("TITLE", changes.title);
  replaceText("ARTIST", changes.artist);
  replaceText("ALBUMARTIST", changes.albumArtist);
  replaceText("ALBUM", changes.album);
  replaceText("COMPOSER", changes.composer);
  replaceText("COMMENT", changes.comment);
  replaceText("COPYRIGHT", changes.copyright);
  replaceText("LANGUAGE", changes.language);
  if (changes.year !== undefined) {
    replacements.set(
      "DATE",
      changes.year === null ? [] : [encodeComment("DATE", String(changes.year))],
    );
    replacements.set("YEAR", []);
  }
  if (changes.dateText !== undefined) {
    replaceText("DATE", changes.dateText);
    replacements.set("YEAR", []);
  }
  if (changes.genre !== undefined) {
    const genres = (Array.isArray(changes.genre) ? changes.genre : [changes.genre]).filter(Boolean);
    replacements.set(
      "GENRE",
      genres.map((genre) => encodeComment("GENRE", genre)),
    );
  }
  if (changes.trackNumber !== undefined) {
    const total = firstValue(tags.comments, "TRACKNUMBER", "TRACK")?.match(
      /^\s*\d+\s*\/\s*(\d+)/u,
    )?.[1];
    replacements.set(
      "TRACKNUMBER",
      changes.trackNumber === null
        ? []
        : [encodeComment("TRACKNUMBER", `${changes.trackNumber}${total ? `/${total}` : ""}`)],
    );
    replacements.set("TRACK", []);
  }
  if (changes.trackText !== undefined) {
    replaceText("TRACKNUMBER", changes.trackText);
    replacements.set("TRACK", []);
  }
  if (changes.discNumber !== undefined) {
    const total = firstValue(tags.comments, "DISCNUMBER")?.match(/^\s*\d+\s*\/\s*(\d+)/u)?.[1];
    replacements.set(
      "DISCNUMBER",
      changes.discNumber === null
        ? []
        : [encodeComment("DISCNUMBER", `${changes.discNumber}${total ? `/${total}` : ""}`)],
    );
  }
  if (changes.bpm !== undefined) {
    replacements.set(
      "BPM",
      changes.bpm === null ? [] : [encodeComment("BPM", String(changes.bpm))],
    );
  }
  if (changes.picture !== undefined) {
    if (changes.picture.length > MAX_PICTURES) {
      throw writeFailure("Opus picture count exceeds the safety limit.");
    }
    replacements.set(
      "METADATA_BLOCK_PICTURE",
      changes.picture.map((picture) => {
        if ((picture.opaqueData?.length ?? picture.data.length) > MAX_PICTURE_BYTES) {
          throw writeFailure("Opus picture exceeds the 32 MiB safety limit.");
        }
        const payload = picture.opaqueData ?? encodePicture(picture);
        if (payload.length > MAX_PICTURE_BYTES) {
          throw writeFailure("Opus picture exceeds the 32 MiB safety limit.");
        }
        return encodeComment("METADATA_BLOCK_PICTURE", encodeBase64(payload));
      }),
    );
  }

  const comments: Uint8Array<ArrayBuffer>[] = [];
  const emitted = new Set<string>();
  for (const comment of tags.comments) {
    const key = comment.key.toUpperCase();
    if (!replacements.has(key)) {
      comments.push(comment.bytes);
    } else if (!emitted.has(key)) {
      comments.push(...replacements.get(key)!);
      emitted.add(key);
    }
  }
  for (const [key, values] of replacements) {
    if (!emitted.has(key)) comments.push(...values);
  }
  if (comments.length > MAX_VORBIS_COMMENTS) {
    throw writeFailure("rewritten OpusTags comment count exceeds the safety limit.");
  }
  let packetLength = 8 + 4 + tags.vendor.length + 4 + tags.trailing.length;
  for (const comment of comments) {
    packetLength += 4 + comment.length;
    if (packetLength > MAX_TAG_BYTES) {
      throw writeFailure("rewritten OpusTags packet exceeds 64 MiB.");
    }
  }
  const packet = new Uint8Array(packetLength);
  let offset = 0;
  packet.set(asciiBytes("OpusTags"), offset);
  offset += 8;
  writeUint32LE(packet, offset, tags.vendor.length);
  offset += 4;
  packet.set(tags.vendor, offset);
  offset += tags.vendor.length;
  writeUint32LE(packet, offset, comments.length);
  offset += 4;
  for (const comment of comments) {
    writeUint32LE(packet, offset, comment.length);
    offset += 4;
    packet.set(comment, offset);
    offset += comment.length;
  }
  packet.set(tags.trailing, offset);
  return packet;
};

const makeOggPage = (
  body: Uint8Array<ArrayBuffer>,
  segments: Uint8Array<ArrayBuffer>,
  serial: number,
  sequence: number,
  headerType: number,
  granulePosition: bigint,
) => {
  const page = new Uint8Array(27 + segments.length + body.length);
  page.set(asciiBytes("OggS"));
  page[4] = 0;
  page[5] = headerType;
  writeUint64LE(page, 6, granulePosition);
  writeUint32LE(page, 14, serial);
  writeUint32LE(page, 18, sequence);
  page[26] = segments.length;
  page.set(segments, 27);
  page.set(body, 27 + segments.length);
  writeUint32LE(page, 22, oggCrc(page));
  return page;
};

const paginateTags = (packet: Uint8Array<ArrayBuffer>, serial: number, firstSequence: number) => {
  const lacing: number[] = [];
  let remaining = packet.length;
  while (remaining >= 255) {
    lacing.push(255);
    remaining -= 255;
  }
  lacing.push(remaining);
  const pages: Uint8Array<ArrayBuffer>[] = [];
  let laceOffset = 0;
  let bodyOffset = 0;
  while (laceOffset < lacing.length) {
    const pageLacing = lacing.slice(laceOffset, laceOffset + 255);
    const bodyLength = pageLacing.reduce((total, length) => total + length, 0);
    const final = laceOffset + pageLacing.length === lacing.length;
    pages.push(
      makeOggPage(
        packet.slice(bodyOffset, bodyOffset + bodyLength),
        Uint8Array.from(pageLacing),
        serial,
        (firstSequence + pages.length) % UINT32_MODULUS,
        pages.length === 0 ? 0 : 0x01,
        final ? 0n : -1n,
      ),
    );
    laceOffset += pageLacing.length;
    bodyOffset += bodyLength;
  }
  return pages;
};

const bytesEqual = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

const inspect = (source: ByteSource) =>
  Effect.gen(function* () {
    const parsed = yield* inspectStructure(source);
    const comments = parsed.tags.comments;
    const pictures: ArtworkEntry[] = [];
    const genres: string[] = [];
    for (const comment of comments) {
      const key = comment.key.toUpperCase();
      if (key === "GENRE") genres.push(comment.value);
      if (key !== "METADATA_BLOCK_PICTURE") continue;
      if (pictures.length >= MAX_PICTURES) {
        return yield* failRead("Opus picture count exceeds the safety limit.");
      }
      const picture = yield* parseReadable(
        () => parsePicture(decodeBase64(comment.value)),
        "Opus picture",
      );
      pictures.push(picture);
    }
    const duration = (Number(parsed.finalGranule) - parsed.preSkip) / 48_000;
    const trackText = firstValue(comments, "TRACKNUMBER", "TRACK");
    const trackTotalMatch = trackText?.match(/^\s*\d+\s*\/\s*(\d+)/u);
    const metadata: AudioInspection["metadata"] = {
      title: firstValue(comments, "TITLE") ?? "",
      artist: firstValue(comments, "ARTIST") ?? "",
      albumArtist: firstValue(comments, "ALBUMARTIST") ?? "",
      album: firstValue(comments, "ALBUM") ?? "",
      year: yearValue(firstValue(comments, "DATE", "YEAR")),
      genre: genres.length > 1 ? genres : (genres[0] ?? ""),
      duration,
      bitrate: duration > 0 ? Math.round(((source.size - parsed.audioOffset) * 8) / duration) : 0,
      sampleRate: 48_000,
      picture: pictures,
      trackNumber: positiveInteger(trackText),
      trackTotal: trackTotalMatch ? Number.parseInt(trackTotalMatch[1]!, 10) : null,
      composer: firstValue(comments, "COMPOSER") ?? "",
      comment: firstValue(comments, "COMMENT") ?? "",
      discNumber: canonicalInteger(firstValue(comments, "DISCNUMBER")),
      bpm: canonicalInteger(firstValue(comments, "BPM")),
    };
    return { format, metadata } satisfies AudioInspection;
  }).pipe(
    Effect.catchDefect((cause) =>
      Effect.fail(readFailure("unable to inspect Opus metadata.", cause)),
    ),
    Effect.mapError((error) =>
      error instanceof AudioMetadataReadError
        ? error
        : readFailure("unable to inspect Opus metadata.", error),
    ),
  );

const patch = (source: ByteSource, changes: MetadataChanges) => {
  const unsupported = rejectUnsupportedMetadataChanges(
    changes,
    new Set<keyof MetadataChanges>([
      "title",
      "artist",
      "albumArtist",
      "album",
      "year",
      "genre",
      "trackNumber",
      "discNumber",
      "composer",
      "bpm",
      "comment",
      "copyright",
      "language",
      "picture",
      "dateText",
      "trackText",
    ]),
    format.kind,
  );
  if (unsupported) return Effect.fail(unsupported);
  if (Object.values(changes).every((value) => value === undefined)) {
    return Effect.succeed({
      parts: [source.slice()],
      type: format.mime,
    } satisfies PatchPlan);
  }
  return Effect.gen(function* () {
    const parsed = yield* parseStructure(source).pipe(
      Effect.mapError((error) => writeFailure(error.message, error)),
    );
    const packet = yield* Effect.try({
      try: () => encodeTags(parsed.tags, changes),
      catch: (cause) =>
        cause instanceof AudioMetadataWriteError
          ? cause
          : writeFailure("unable to encode OpusTags metadata.", cause),
    });
    if (packet.length > MAX_TAG_BYTES) {
      return yield* Effect.fail(writeFailure("rewritten OpusTags packet exceeds 64 MiB."));
    }
    if (bytesEqual(packet, parsed.tagPacket)) {
      return { parts: [source.slice()], type: format.mime } satisfies PatchPlan;
    }
    const firstTagPage = parsed.pages[parsed.tagStartIndex]!;
    const replacementPages = paginateTags(packet, parsed.serial, firstTagPage.sequence);
    const delta = replacementPages.length - parsed.tagPageIndexes.size;
    const oldTagLastPage = parsed.streamPages[parsed.tagStreamEndIndex]!;
    const parts: BlobPart[] = [];
    let cursor = 0;
    let inserted = false;
    for (const page of parsed.pages) {
      if (page.index === parsed.tagStartIndex) {
        if (cursor < page.offset) parts.push(source.slice(cursor, page.offset));
        parts.push(...replacementPages);
        inserted = true;
        cursor = page.offset + page.length;
        continue;
      }
      if (parsed.tagPageIndexes.has(page.index)) {
        if (cursor < page.offset) parts.push(source.slice(cursor, page.offset));
        cursor = page.offset + page.length;
        continue;
      }
      if (delta !== 0 && page.serial === parsed.serial && page.sequence > oldTagLastPage.sequence) {
        if (cursor < page.offset) parts.push(source.slice(cursor, page.offset));
        const rewritten = (yield* source.read(page.offset, page.length)).slice();
        const sequence = (page.sequence + delta + UINT32_MODULUS) % UINT32_MODULUS;
        writeUint32LE(rewritten, 18, sequence);
        writeUint32LE(rewritten, 22, 0);
        writeUint32LE(rewritten, 22, oggCrc(rewritten));
        parts.push(rewritten);
        cursor = page.offset + page.length;
      }
    }
    if (!inserted) return yield* Effect.fail(writeFailure("unable to locate OpusTags pages."));
    if (cursor < source.size) parts.push(source.slice(cursor));
    return { parts, type: format.mime } satisfies PatchPlan;
  }).pipe(
    Effect.catchDefect((cause) =>
      Effect.fail(writeFailure("unable to patch Opus metadata.", cause)),
    ),
    Effect.mapError((error) =>
      error instanceof AudioMetadataWriteError
        ? error
        : writeFailure("unable to patch Opus metadata.", error),
    ),
  );
};

export const opusDriver: FormatDriver = { format, inspect, patch };
