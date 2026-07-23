import { Effect } from "effect";
import { AudioMetadataReadError, AudioMetadataWriteError } from "@/features/audio/audioErrors";
import {
  concatBytes,
  readUint24BE,
  readUint32BE,
  readUint32LE,
  uint24BE,
  uint32BE,
  uint32LE,
} from "@/features/audio/metadataEngine/binary";
import {
  MAX_METADATA_READ_BYTES,
  type ByteSource,
} from "@/features/audio/metadataEngine/byteSource";
import type { FormatDriver } from "@/features/audio/metadataEngine/driver";
import type {
  ArtworkEntry,
  AudioInspection,
  MetadataChanges,
  PatchPlan,
} from "@/features/audio/metadataEngine/types";

const format = { kind: "flac", extension: "flac", mime: "audio/flac" } as const;
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();
const MAX_METADATA_BLOCKS = 100_000;
const MAX_TOTAL_METADATA_BYTES = 64 * 1024 * 1024;
const MAX_VORBIS_COMMENTS = 100_000;
const MAX_PICTURES = 256;

interface FlacBlock {
  readonly type: number;
  readonly headerOffset: number;
  readonly dataOffset: number;
  readonly length: number;
  readonly last: boolean;
}

interface ParsedFlac {
  readonly blocks: FlacBlock[];
  readonly audioOffset: number;
  readonly sampleRate: number;
  readonly totalSamples: number;
}

interface VorbisComment {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly key: string | undefined;
  readonly value: string | undefined;
}

interface VorbisBlock {
  readonly vendor: Uint8Array<ArrayBuffer>;
  readonly comments: VorbisComment[];
}

const readFailure = (message: string, cause?: unknown) =>
  new AudioMetadataReadError({ message, cause });

const writeFailure = (message: string, cause?: unknown) =>
  new AudioMetadataWriteError({ message, cause });

const failRead = (message: string) => Effect.fail(readFailure(message));

const readChunked = (source: ByteSource, offset: number, length: number) =>
  Effect.gen(function* () {
    const result = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      const chunkLength = Math.min(length - written, MAX_METADATA_READ_BYTES);
      const chunk = yield* source.read(offset + written, chunkLength);
      if (chunk.length !== chunkLength) {
        return yield* failRead("FLAC file is truncated in a metadata block.");
      }
      result.set(chunk, written);
      written += chunkLength;
    }
    return result;
  });

const parseStructure = (source: ByteSource) =>
  Effect.gen(function* () {
    if (source.size < 42) return yield* failRead("FLAC file is truncated.");
    const signature = yield* source.read(0, 4);
    if (
      signature[0] !== 0x66 ||
      signature[1] !== 0x4c ||
      signature[2] !== 0x61 ||
      signature[3] !== 0x43
    ) {
      return yield* failRead("input does not contain a FLAC stream marker.");
    }

    const blocks: FlacBlock[] = [];
    let offset = 4;
    let last = false;
    let totalMetadataBytes = 0;
    while (!last) {
      if (blocks.length >= MAX_METADATA_BLOCKS) {
        return yield* failRead("FLAC metadata block count exceeds the safety limit.");
      }
      if (offset + 4 > source.size) {
        return yield* failRead("FLAC file is truncated before the final metadata block.");
      }
      const header = yield* source.read(offset, 4);
      last = (header[0]! & 0x80) !== 0;
      const type = header[0]! & 0x7f;
      const length = readUint24BE(header, 1);
      totalMetadataBytes += 4 + length;
      if (totalMetadataBytes > MAX_TOTAL_METADATA_BYTES) {
        return yield* failRead("FLAC metadata exceeds the 64 MiB aggregate safety limit.");
      }
      if (type === 127) return yield* failRead("FLAC metadata contains a forbidden block type.");
      if (offset + 4 + length > source.size) {
        return yield* failRead("FLAC file is truncated in a metadata block.");
      }
      blocks.push({ type, headerOffset: offset, dataOffset: offset + 4, length, last });
      offset += 4 + length;
    }

    const streamInfo = blocks[0];
    if (!streamInfo || streamInfo.type !== 0 || streamInfo.length !== 34) {
      return yield* failRead("FLAC STREAMINFO must be the first metadata block and 34 bytes long.");
    }
    if (blocks.slice(1).some((block) => block.type === 0)) {
      return yield* failRead("FLAC contains more than one STREAMINFO block.");
    }
    if (offset + 2 > source.size) return yield* failRead("FLAC stream contains no audio frames.");

    const info = yield* source.read(streamInfo.dataOffset, 34);
    const sampleRate = info[10]! * 4096 + info[11]! * 16 + (info[12]! >>> 4);
    const totalSamples = (info[13]! & 0x0f) * 0x1_0000_0000 + readUint32BE(info, 14);
    if (sampleRate === 0) return yield* failRead("FLAC STREAMINFO has an invalid sample rate.");
    const sync = yield* source.read(offset, 2);
    if (sync[0] !== 0xff || (sync[1]! & 0xfc) !== 0xf8) {
      return yield* failRead("FLAC audio frame sync is missing or corrupt.");
    }
    return { blocks, audioOffset: offset, sampleRate, totalSamples } satisfies ParsedFlac;
  });

const decodeUtf8 = (bytes: Uint8Array, context: string) => {
  try {
    return textDecoder.decode(bytes);
  } catch (cause) {
    throw readFailure(`FLAC ${context} is not valid UTF-8.`, cause);
  }
};

const parseVorbis = (bytes: Uint8Array<ArrayBuffer>): VorbisBlock => {
  let offset = 0;
  const takeLength = (context: string) => {
    if (offset + 4 > bytes.length) throw readFailure(`FLAC Vorbis ${context} is truncated.`);
    const length = readUint32LE(bytes, offset);
    offset += 4;
    if (offset + length > bytes.length) throw readFailure(`FLAC Vorbis ${context} is truncated.`);
    return length;
  };
  const vendorLength = takeLength("vendor");
  const vendor = bytes.slice(offset, offset + vendorLength);
  decodeUtf8(vendor, "Vorbis vendor");
  offset += vendorLength;
  if (offset + 4 > bytes.length) throw readFailure("FLAC Vorbis comment count is truncated.");
  const count = readUint32LE(bytes, offset);
  offset += 4;
  if (count > MAX_VORBIS_COMMENTS) {
    throw readFailure("FLAC Vorbis comment count exceeds the safety limit.");
  }
  if (count > Math.floor((bytes.length - offset) / 4)) {
    throw readFailure("FLAC Vorbis comment count exceeds the block size.");
  }
  const comments: VorbisComment[] = [];
  for (let index = 0; index < count; index++) {
    const length = takeLength("comment");
    const raw = bytes.slice(offset, offset + length);
    offset += length;
    const decoded = decodeUtf8(raw, "Vorbis comment");
    const equals = decoded.indexOf("=");
    if (equals < 1 || !/^[\x20-\x3c\x3e-\x7d]+$/.test(decoded.slice(0, equals))) {
      throw readFailure("FLAC Vorbis comment has an invalid field name.");
    }
    comments.push({
      bytes: raw,
      key: decoded.slice(0, equals),
      value: decoded.slice(equals + 1),
    });
  }
  if (offset !== bytes.length) throw readFailure("FLAC Vorbis comment block has trailing bytes.");
  return { vendor, comments };
};

const parsePicture = (bytes: Uint8Array<ArrayBuffer>): ArtworkEntry => {
  let offset = 0;
  const takeU32 = (context: string) => {
    if (offset + 4 > bytes.length) throw readFailure(`FLAC picture ${context} is truncated.`);
    const value = readUint32BE(bytes, offset);
    offset += 4;
    return value;
  };
  const type = takeU32("type");
  const mimeLength = takeU32("MIME length");
  if (offset + mimeLength > bytes.length) throw readFailure("FLAC picture MIME type is truncated.");
  const mime = decodeUtf8(bytes.subarray(offset, offset + mimeLength), "picture MIME type");
  offset += mimeLength;
  const descriptionLength = takeU32("description length");
  if (offset + descriptionLength > bytes.length) {
    throw readFailure("FLAC picture description is truncated.");
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
  if (offset + dataLength !== bytes.length) {
    throw readFailure("FLAC picture data length does not match its block.");
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

const parseReadableBlock = <A>(
  effect: Effect.Effect<Uint8Array<ArrayBuffer>, AudioMetadataReadError>,
  parse: (bytes: Uint8Array<ArrayBuffer>) => A,
) =>
  effect.pipe(
    Effect.flatMap((bytes) =>
      Effect.try({ try: () => parse(bytes), catch: (error) => error as AudioMetadataReadError }),
    ),
  );

const firstValue = (comments: VorbisComment[], ...keys: string[]) => {
  const accepted = new Set(keys);
  return comments.find((comment) => comment.key && accepted.has(comment.key.toUpperCase()))?.value;
};

const positiveInteger = (value: string | undefined) => {
  const head = value?.split("/", 1)[0]?.trim();
  if (!head || !/^\d+$/.test(head)) return null;
  const number = Number(head);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const yearValue = (value: string | undefined) => {
  const match = value?.match(/^\s*(\d{4})/);
  return match ? Number(match[1]) : null;
};

const inspect = (source: ByteSource) =>
  Effect.gen(function* () {
    const parsed = yield* parseStructure(source);
    const comments: VorbisComment[] = [];
    const pictures: ArtworkEntry[] = [];
    for (const block of parsed.blocks) {
      if (block.type === 4) {
        const vorbis = yield* parseReadableBlock(
          readChunked(source, block.dataOffset, block.length),
          parseVorbis,
        );
        comments.push(...vorbis.comments);
      } else if (block.type === 6) {
        if (pictures.length >= MAX_PICTURES) {
          return yield* Effect.fail(readFailure("FLAC picture count exceeds the safety limit."));
        }
        pictures.push(
          yield* parseReadableBlock(
            readChunked(source, block.dataOffset, block.length),
            parsePicture,
          ),
        );
      }
    }
    const genres: string[] = [];
    for (const comment of comments) {
      if (comment.key?.toUpperCase() === "GENRE") {
        genres.push(comment.value ?? "");
      }
    }
    const duration = parsed.totalSamples / parsed.sampleRate;
    const trackText = firstValue(comments, "TRACKNUMBER", "TRACK");
    const trackTotalMatch = trackText?.match(/^\s*\d+\s*\/\s*(\d+)/u);
    const metadata: AudioInspection["metadata"] = {
      title: firstValue(comments, "TITLE") ?? "",
      artist: firstValue(comments, "ARTIST") ?? "",
      album: firstValue(comments, "ALBUM") ?? "",
      year: yearValue(firstValue(comments, "DATE", "YEAR")),
      genre: genres.length > 1 ? genres : (genres[0] ?? ""),
      duration,
      bitrate: duration > 0 ? Math.round(((source.size - parsed.audioOffset) * 8) / duration) : 0,
      sampleRate: parsed.sampleRate,
      picture: pictures,
      trackNumber: positiveInteger(trackText),
      trackTotal: trackTotalMatch ? Number.parseInt(trackTotalMatch[1]!, 10) : null,
    };
    return { format, metadata } satisfies AudioInspection;
  });

const encodeComment = (key: string, value: string) => textEncoder.encode(`${key}=${value}`);

const encodeVorbis = (
  block: VorbisBlock,
  changes: MetadataChanges,
  includeReplacementValues = true,
) => {
  const replacements = new Map<string, Uint8Array<ArrayBuffer>[]>();
  if (changes.title !== undefined) {
    replacements.set(
      "TITLE",
      includeReplacementValues ? [encodeComment("TITLE", changes.title)] : [],
    );
  }
  if (changes.artist !== undefined) {
    replacements.set(
      "ARTIST",
      includeReplacementValues ? [encodeComment("ARTIST", changes.artist)] : [],
    );
  }
  if (changes.album !== undefined) {
    replacements.set(
      "ALBUM",
      includeReplacementValues ? [encodeComment("ALBUM", changes.album)] : [],
    );
  }
  if (changes.year !== undefined) {
    replacements.set(
      "DATE",
      changes.year === null || !includeReplacementValues
        ? []
        : [encodeComment("DATE", String(changes.year))],
    );
    replacements.set("YEAR", []);
  }
  if (changes.genre !== undefined) {
    const values = Array.isArray(changes.genre) ? changes.genre : [changes.genre];
    replacements.set(
      "GENRE",
      includeReplacementValues ? values.map((value) => encodeComment("GENRE", value)) : [],
    );
  }
  if (changes.trackNumber !== undefined) {
    const existingTrack = block.comments.find((comment) =>
      ["TRACKNUMBER", "TRACK"].includes(comment.key?.toUpperCase() ?? ""),
    )?.value;
    const total = existingTrack?.match(/^\s*\d+\s*\/\s*(\d+)/u)?.[1];
    const value =
      changes.trackNumber === null ? "" : `${changes.trackNumber}${total ? `/${total}` : ""}`;
    replacements.set(
      "TRACKNUMBER",
      changes.trackNumber === null || !includeReplacementValues
        ? []
        : [encodeComment("TRACKNUMBER", value)],
    );
    replacements.set("TRACK", []);
  }

  const output: Uint8Array<ArrayBuffer>[] = [];
  const emitted = new Set<string>();
  for (const comment of block.comments) {
    const key = comment.key?.toUpperCase();
    if (!key || !replacements.has(key)) {
      output.push(comment.bytes);
    } else if (!emitted.has(key)) {
      output.push(...replacements.get(key)!);
      emitted.add(key);
    }
  }
  for (const [key, values] of replacements) {
    if (!emitted.has(key)) output.push(...values);
  }
  return concatBytes(
    uint32LE(block.vendor.length),
    block.vendor,
    uint32LE(output.length),
    ...output.flatMap((comment) => [uint32LE(comment.length), comment]),
  );
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

const blockHeader = (type: number, length: number, last: boolean) => {
  if (length > 0xff_ffff) throw writeFailure("rewritten FLAC metadata block is too large.");
  return concatBytes(Uint8Array.of(type | (last ? 0x80 : 0)), uint24BE(length));
};

const patch = (source: ByteSource, changes: MetadataChanges) => {
  if (Object.values(changes).every((value) => value === undefined)) {
    return Effect.succeed({ parts: [source.slice()], type: format.mime } satisfies PatchPlan);
  }
  return Effect.gen(function* () {
    const parsed = yield* parseStructure(source);
    const editsComments =
      changes.title !== undefined ||
      changes.artist !== undefined ||
      changes.album !== undefined ||
      changes.year !== undefined ||
      changes.genre !== undefined ||
      changes.trackNumber !== undefined;
    const replacementPictures = changes.picture?.map(
      (picture) => picture.opaqueData ?? encodePicture(picture),
    );
    const entries: Array<{ type: number; payload: BlobPart; length: number }> = [];
    let commentsEdited = false;
    let picturesInserted = false;

    for (const block of parsed.blocks) {
      if (block.type === 4 && editsComments) {
        const vorbis = yield* parseReadableBlock(
          readChunked(source, block.dataOffset, block.length),
          parseVorbis,
        );
        const payload = encodeVorbis(vorbis, changes, !commentsEdited);
        entries.push({ type: 4, payload, length: payload.length });
        commentsEdited = true;
      } else if (block.type === 6 && replacementPictures !== undefined) {
        if (!picturesInserted) {
          for (const payload of replacementPictures) {
            entries.push({ type: 6, payload, length: payload.length });
          }
          picturesInserted = true;
        }
      } else {
        entries.push({
          type: block.type,
          payload: source.slice(block.dataOffset, block.dataOffset + block.length),
          length: block.length,
        });
      }
    }

    if (editsComments && !commentsEdited) {
      const payload = encodeVorbis({ vendor: textEncoder.encode("Tagium"), comments: [] }, changes);
      entries.splice(1, 0, { type: 4, payload, length: payload.length });
    }
    if (replacementPictures !== undefined && !picturesInserted) {
      const insertion = Math.max(1, entries.findIndex((entry) => entry.type === 4) + 1);
      entries.splice(
        insertion,
        0,
        ...replacementPictures.map((payload) => ({ type: 6, payload, length: payload.length })),
      );
    }
    if (entries.some((entry) => entry.length > 0xff_ffff)) {
      return yield* Effect.fail(writeFailure("rewritten FLAC metadata block is too large."));
    }
    const parts: BlobPart[] = [new Uint8Array([0x66, 0x4c, 0x61, 0x43])];
    entries.forEach((entry, index) => {
      parts.push(
        blockHeader(entry.type, entry.length, index === entries.length - 1),
        entry.payload,
      );
    });
    parts.push(source.slice(parsed.audioOffset));
    return { parts, type: format.mime } satisfies PatchPlan;
  }).pipe(
    Effect.mapError((error) =>
      error instanceof AudioMetadataWriteError
        ? error
        : writeFailure(`unable to patch FLAC metadata: ${error.message}`, error),
    ),
  );
};

export const flacDriver: FormatDriver = { format, inspect, patch };
