import { Effect } from "effect";
import { AudioMetadataReadError, AudioMetadataWriteError } from "@/features/audio/audioErrors";
import {
  ascii,
  asciiBytes,
  concatBytes,
  numberToSynchsafe,
  readUint32BE,
  readUint32LE,
  synchsafeToNumber,
  uint32BE,
} from "@/features/audio/metadataEngine/binary";
import type { ByteSource } from "@/features/audio/metadataEngine/byteSource";
import type { FormatDriver } from "@/features/audio/metadataEngine/driver";
import type { ArtworkEntry, MetadataChanges } from "@/features/audio/metadataEngine/types";

const format = { kind: "mp3", extension: "mp3", mime: "audio/mpeg" } as const;
const textDecoder = new TextDecoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });
const latinDecoder = new TextDecoder("windows-1252");

const trimNulls = (value: string) => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0) end--;
  return value.slice(0, end);
};

const trimNullsAndSpaces = (value: string) => {
  let end = value.length;
  while (end > 0 && (value.charCodeAt(end - 1) === 0 || value[end - 1] === " ")) end--;
  return value.slice(0, end);
};

const deunsynchronise = (bytes: Uint8Array<ArrayBuffer>) => {
  const output: number[] = [];
  for (let index = 0; index < bytes.length; index++) {
    const value = bytes[index]!;
    output.push(value);
    if (
      value === 0xff &&
      bytes[index + 1] === 0 &&
      (index + 2 >= bytes.length || bytes[index + 2] === 0 || bytes[index + 2]! >= 0xe0)
    )
      index++;
  }
  return Uint8Array.from(output);
};

const unsynchronise = (bytes: Uint8Array) => {
  const output: number[] = [];
  for (let index = 0; index < bytes.length; index++) {
    const value = bytes[index]!;
    output.push(value);
    const next = bytes[index + 1];
    if (value === 0xff && (next === undefined || next === 0 || next >= 0xe0)) output.push(0);
  }
  return Uint8Array.from(output);
};

type Id3Version = 2 | 3 | 4;
type RawFrame = { id: string; bytes: Uint8Array<ArrayBuffer> };
type ParsedTag = {
  version: Id3Version;
  revision: number;
  end: number;
  flags: number;
  frames: RawFrame[];
};

const readFailure = (message: string, cause?: unknown) =>
  new AudioMetadataReadError({ message, cause });
const writeFailure = (message: string, cause?: unknown) =>
  new AudioMetadataWriteError({ message, cause });

const decodeUtf16 = (bytes: Uint8Array, bigEndian = false) => {
  let offset = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    bigEndian = false;
    offset = 2;
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    bigEndian = true;
    offset = 2;
  }
  const codeUnits: number[] = [];
  for (; offset + 1 < bytes.length; offset += 2) {
    const value = bigEndian
      ? bytes[offset]! * 0x100 + bytes[offset + 1]!
      : bytes[offset + 1]! * 0x100 + bytes[offset]!;
    codeUnits.push(value);
  }
  let output = "";
  for (let index = 0; index < codeUnits.length; index += 8192) {
    output += String.fromCharCode(...codeUnits.slice(index, index + 8192));
  }
  return output;
};

const decodeText = (payload: Uint8Array, version: Id3Version) => {
  const encoding = payload[0] ?? 0;
  if (encoding > (version === 4 ? 3 : 1)) {
    throw readFailure(`ID3v2.${version} text frame uses unsupported encoding ${encoding}.`);
  }
  const body = payload.subarray(1);
  const value =
    encoding === 0
      ? latinDecoder.decode(body)
      : encoding === 1
        ? decodeUtf16(body)
        : encoding === 2
          ? decodeUtf16(body, true)
          : fatalTextDecoder.decode(body);
  return trimNulls(value);
};

const encodeText = (value: string, version: Id3Version) => {
  if (version === 4) return concatBytes(Uint8Array.of(3), new TextEncoder().encode(value));
  const bytes = new Uint8Array(3 + value.length * 2);
  bytes.set([1, 0xff, 0xfe]);
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    bytes[3 + index * 2] = code & 0xff;
    bytes[4 + index * 2] = code >>> 8;
  }
  return bytes;
};

const parseId3 = (bytes: Uint8Array<ArrayBuffer>): ParsedTag | undefined => {
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== "ID3") return undefined;
  const version = bytes[3] as Id3Version;
  if (![2, 3, 4].includes(version)) throw readFailure(`unsupported ID3v2.${version} tag.`);
  const flags = bytes[5]!;
  if (version === 2 && (flags & 0x40) !== 0) {
    throw readFailure(`ID3v2.${version} compressed tags are not safely editable.`);
  }
  if ([bytes[6], bytes[7], bytes[8], bytes[9]].some((value) => (value! & 0x80) !== 0)) {
    throw readFailure("invalid ID3 synchsafe size.");
  }
  const payloadSize = synchsafeToNumber(bytes, 6);
  const footerSize = version === 4 && (bytes[5]! & 0x10) !== 0 ? 10 : 0;
  const end = 10 + payloadSize + footerSize;
  if (end > bytes.length) throw readFailure("truncated ID3 tag.");
  if ((flags & 0x80) !== 0) {
    const decodedBody = deunsynchronise(bytes.slice(10, 10 + payloadSize));
    const logical = concatBytes(
      bytes.slice(0, 5),
      Uint8Array.of(flags & ~0x90),
      numberToSynchsafe(decodedBody.length),
      decodedBody,
    );
    const parsed = parseId3(logical);
    if (!parsed) throw readFailure("unable to decode unsynchronised ID3 tag.");
    return { ...parsed, flags, end };
  }
  let offset = 10;
  if ((bytes[5]! & 0x40) !== 0) {
    if (version === 3) offset += 4 + readUint32BE(bytes, offset);
    else if (version === 4) offset += synchsafeToNumber(bytes, offset);
  }
  const headerSize = version === 2 ? 6 : 10;
  const frames: RawFrame[] = [];
  while (offset + headerSize <= 10 + payloadSize) {
    const idLength = version === 2 ? 3 : 4;
    const id = ascii(bytes, offset, idLength);
    if (Array.from(id).every((character) => character.charCodeAt(0) === 0)) break;
    if (!/^[A-Z0-9]{3,4}$/u.test(id))
      throw readFailure(`invalid ID3 frame id ${JSON.stringify(id)}.`);
    const size =
      version === 2
        ? bytes[offset + 3]! * 0x10000 + bytes[offset + 4]! * 0x100 + bytes[offset + 5]!
        : version === 4
          ? synchsafeToNumber(bytes, offset + 4)
          : readUint32BE(bytes, offset + 4);
    const frameEnd = offset + headerSize + size;
    if (size <= 0 || frameEnd > 10 + payloadSize) throw readFailure(`truncated ID3 frame ${id}.`);
    const owned = Object.values(ids).some((frameIds) => frameIds.includes(id as never));
    const formatFlags = version === 2 ? 0 : bytes[offset + 9]!;
    const unsupportedOwnedFlags =
      version === 3
        ? (formatFlags & 0xe0) !== 0
        : version === 4
          ? (formatFlags & 0x4f) !== 0
          : false;
    if (owned && unsupportedOwnedFlags) {
      throw readFailure(
        `ID3 frame ${id} uses unsupported compression, encryption, grouping, or unsynchronisation flags.`,
      );
    }
    frames.push({ id, bytes: bytes.slice(offset, frameEnd) });
    offset = frameEnd;
  }
  return { version, revision: bytes[4]!, end, flags, frames };
};

const payloadOf = (frame: RawFrame, version: Id3Version) =>
  frame.bytes.subarray(version === 2 ? 6 : 10);

const ids = {
  title: ["TIT2", "TT2"],
  artist: ["TPE1", "TP1"],
  album: ["TALB", "TAL"],
  year: ["TDRC", "TYER", "TYE"],
  genre: ["TCON", "TCO"],
  trackNumber: ["TRCK", "TRK"],
  picture: ["APIC", "PIC"],
  dateText: ["TDRC", "TYER", "TYE"],
  trackText: ["TRCK", "TRK"],
  albumArtist: ["TPE2", "TP2"],
  composer: ["TCOM", "TCM"],
  copyright: ["TCOP", "TCR"],
  language: ["TLAN", "TLA"],
} as const;

const idFor = (key: keyof typeof ids, version: Id3Version) =>
  version === 2 ? ids[key].at(-1)! : ids[key][0];

const firstText = (tag: ParsedTag | undefined, frameIds: readonly string[]) => {
  const frame = tag?.frames.find((candidate) => frameIds.includes(candidate.id));
  return frame && decodeText(payloadOf(frame, tag!.version), tag!.version);
};

const splitTerminated = (bytes: Uint8Array, encoding: number) => {
  const stride = encoding === 1 || encoding === 2 ? 2 : 1;
  for (let index = 0; index + stride <= bytes.length; index += stride) {
    if (bytes[index] === 0 && (stride === 1 || bytes[index + 1] === 0)) {
      return [bytes.subarray(0, index), bytes.subarray(index + stride)] as const;
    }
  }
  return [bytes, bytes.subarray(bytes.length)] as const;
};

const parsePicture = (frame: RawFrame, version: Id3Version): ArtworkEntry | undefined => {
  const payload = payloadOf(frame, version);
  const encoding = payload[0] ?? 0;
  let offset = 1;
  let mime = "";
  if (version === 2) {
    const imageFormat = ascii(payload, offset, 3).toLowerCase();
    mime = imageFormat === "png" ? "image/png" : "image/jpeg";
    offset += 3;
  } else {
    const end = payload.indexOf(0, offset);
    if (end < 0) return undefined;
    mime = latinDecoder.decode(payload.subarray(offset, end));
    offset = end + 1;
  }
  const type = payload[offset++] ?? 3;
  const [descriptionBytes, data] = splitTerminated(payload.subarray(offset), encoding);
  const description = decodeText(concatBytes(Uint8Array.of(encoding), descriptionBytes), version);
  return { format: mime, type, description, data: data.slice(), opaqueData: frame.bytes.slice() };
};

const parseId3v1 = (tail: Uint8Array) => {
  if (tail.length < 128 || ascii(tail, tail.length - 128, 3) !== "TAG") return {};
  const block = tail.subarray(tail.length - 128);
  const field = (offset: number, length: number) =>
    trimNullsAndSpaces(latinDecoder.decode(block.subarray(offset, offset + length)));
  return {
    title: field(3, 30),
    artist: field(33, 30),
    album: field(63, 30),
    year: field(93, 4),
    trackNumber: block[125] === 0 ? block[126] : undefined,
    genre: block[127] === 255 ? "" : String(block[127]),
  };
};

const parseApe = (tail: Uint8Array) => {
  const footerOffset = tail.length - (ascii(tail, tail.length - 128, 3) === "TAG" ? 160 : 32);
  if (footerOffset < 0 || ascii(tail, footerOffset, 8) !== "APETAGEX") {
    return { values: new Map<string, string>(), size: 0 };
  }
  const size = readUint32LE(tail, footerOffset + 12);
  const count = readUint32LE(tail, footerOffset + 16);
  const start = footerOffset + 32 - size;
  if (size < 32 || start < 0 || count > 100_000) {
    throw readFailure("APEv2 footer declares an invalid size or item count.");
  }
  const values = new Map<string, string>();
  let offset = start;
  for (let index = 0; index < count; index++) {
    if (offset + 8 > footerOffset) throw readFailure("APEv2 item table is truncated.");
    const valueSize = readUint32LE(tail, offset);
    const keyEnd = tail.indexOf(0, offset + 8);
    if (keyEnd < 0 || keyEnd >= footerOffset || keyEnd + 1 + valueSize > footerOffset) {
      throw readFailure("APEv2 item key or value is truncated.");
    }
    const key = ascii(tail, offset + 8, keyEnd - offset - 8).toLowerCase();
    if (!/^[\x20-\x7e]+$/u.test(key)) throw readFailure("APEv2 item key is invalid.");
    if (!values.has(key))
      values.set(key, textDecoder.decode(tail.subarray(keyEnd + 1, keyEnd + 1 + valueSize)));
    offset = keyEnd + 1 + valueSize;
  }
  if (offset !== footerOffset)
    throw readFailure("APEv2 item table does not match its declared size.");
  return { values, size };
};

const getFrameInfo = (bytes: Uint8Array, offset: number) => {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1]! & 0xe0) !== 0xe0)
    return undefined;
  const version = (bytes[offset + 1]! >> 3) & 3;
  const layerBits = (bytes[offset + 1]! >> 1) & 3;
  const bitrateIndex = (bytes[offset + 2]! >> 4) & 15;
  const rateIndex = (bytes[offset + 2]! >> 2) & 3;
  if (
    version === 1 ||
    layerBits === 0 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    rateIndex === 3
  )
    return undefined;
  const mpeg1 = version === 3;
  const layer = 4 - layerBits;
  const rates = [44_100, 48_000, 32_000];
  const sampleRate = rates[rateIndex]! / (mpeg1 ? 1 : version === 2 ? 2 : 4);
  const mpeg1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const mpeg2L23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const generic = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
  const bitrate = (layer === 3 ? (mpeg1 ? mpeg1L3 : mpeg2L23) : generic)[bitrateIndex]! * 1000;
  const padding = (bytes[offset + 2]! >> 1) & 1;
  const frameLength =
    layer === 1
      ? Math.floor(((12 * bitrate) / sampleRate + padding) * 4)
      : Math.floor(((layer === 3 && !mpeg1 ? 72 : 144) * bitrate) / sampleRate + padding);
  const samplesPerFrame = layer === 1 ? 384 : layer === 2 ? 1152 : mpeg1 ? 1152 : 576;
  return { bitrate, sampleRate, frameLength, samplesPerFrame };
};

const readVbrFrameCount = (bytes: Uint8Array, frameOffset: number) => {
  const frameEnd = Math.min(bytes.length, frameOffset + 256);
  for (let offset = frameOffset + 4; offset + 18 <= frameEnd; offset++) {
    const marker = ascii(bytes, offset, 4);
    if (marker === "Xing" || marker === "Info") {
      return (readUint32BE(bytes, offset + 4) & 1) !== 0
        ? readUint32BE(bytes, offset + 8)
        : undefined;
    }
    if (marker === "VBRI") return readUint32BE(bytes, offset + 14);
  }
  return undefined;
};

const makeFrame = (id: string, payload: Uint8Array, version: Id3Version) => {
  if (version === 2) {
    return concatBytes(
      asciiBytes(id),
      Uint8Array.of(
        (payload.length >>> 16) & 0xff,
        (payload.length >>> 8) & 0xff,
        payload.length & 0xff,
      ),
      payload,
    );
  }
  const size = version === 4 ? numberToSynchsafe(payload.length) : uint32BE(payload.length);
  return concatBytes(asciiBytes(id), size, Uint8Array.of(0, 0), payload);
};

const encodePicture = (picture: ArtworkEntry, version: Id3Version) => {
  const encoding = version === 4 ? 3 : 1;
  const description = encodeText(picture.description, version).subarray(1);
  const terminator = encoding === 1 ? Uint8Array.of(0, 0) : Uint8Array.of(0);
  if (version === 2) {
    const imageFormat = picture.format.toLowerCase().includes("png") ? "PNG" : "JPG";
    return concatBytes(
      Uint8Array.of(encoding),
      asciiBytes(imageFormat),
      Uint8Array.of(picture.type),
      description,
      terminator,
      picture.data,
    );
  }
  return concatBytes(
    Uint8Array.of(encoding),
    asciiBytes(picture.format),
    Uint8Array.of(0, picture.type),
    description,
    terminator,
    picture.data,
  );
};

const buildTag = (parsed: ParsedTag | undefined, changes: MetadataChanges) => {
  const version = parsed?.version ?? 4;
  const revision = parsed?.revision ?? 0;
  const flags = parsed?.flags ?? 0;
  const changedIds = new Set<string>();
  for (const key of Object.keys(changes) as Array<keyof MetadataChanges>) {
    if (key in ids) for (const id of ids[key as keyof typeof ids]) changedIds.add(id);
  }
  const frames = (parsed?.frames ?? [])
    .filter((frame) => !changedIds.has(frame.id))
    .map((frame) => frame.bytes);
  const addText = (key: Exclude<keyof typeof ids, "picture">, value: string) => {
    if (value.length > 0)
      frames.push(
        makeFrame(idFor(key as keyof typeof ids, version), encodeText(value, version), version),
      );
  };
  if ("title" in changes) addText("title", changes.title ?? "");
  if ("artist" in changes) addText("artist", changes.artist ?? "");
  if ("album" in changes) addText("album", changes.album ?? "");
  if ("year" in changes) addText("year", changes.year == null ? "" : String(changes.year));
  if ("genre" in changes) {
    addText(
      "genre",
      Array.isArray(changes.genre)
        ? changes.genre.join(version === 4 ? "\0" : ";")
        : (changes.genre ?? ""),
    );
  }
  if ("trackNumber" in changes) {
    const currentTrack = firstText(parsed, ids.trackNumber);
    const total = currentTrack?.match(/^\s*\d+\s*\/\s*(\d+)/u)?.[1];
    addText(
      "trackNumber",
      changes.trackNumber == null ? "" : `${changes.trackNumber}${total ? `/${total}` : ""}`,
    );
  }
  if (changes.dateText !== undefined) addText("dateText", changes.dateText);
  if (changes.trackText !== undefined) addText("trackText", changes.trackText);
  if (changes.albumArtist !== undefined) addText("albumArtist", changes.albumArtist);
  if (changes.composer !== undefined) addText("composer", changes.composer);
  if (changes.copyright !== undefined) addText("copyright", changes.copyright);
  if (changes.language !== undefined) addText("language", changes.language);
  if ("picture" in changes) {
    for (const picture of changes.picture ?? []) {
      frames.push(
        picture.opaqueData ??
          makeFrame(idFor("picture", version), encodePicture(picture, version), version),
      );
    }
  }
  const extendedHeader =
    (flags & 0x40) === 0
      ? new Uint8Array()
      : version === 3
        ? concatBytes(uint32BE(6), new Uint8Array(6))
        : version === 4
          ? concatBytes(numberToSynchsafe(6), Uint8Array.of(1, 0))
          : new Uint8Array();
  const logicalBody = concatBytes(extendedHeader, ...frames);
  const body = (flags & 0x80) !== 0 ? unsynchronise(logicalBody) : logicalBody;
  const size = numberToSynchsafe(body.length);
  const header = concatBytes(
    asciiBytes("ID3"),
    Uint8Array.of(version, revision, flags),
    size,
    body,
  );
  const footer =
    version === 4 && (flags & 0x10) !== 0
      ? concatBytes(asciiBytes("3DI"), Uint8Array.of(version, revision, flags), size)
      : new Uint8Array();
  return concatBytes(header, footer);
};

const readHead = (source: ByteSource) =>
  Effect.gen(function* () {
    const first = yield* source.read(0, Math.min(source.size, 10));
    if (first.length < 10 || ascii(first, 0, 3) !== "ID3") {
      return { bytes: yield* source.read(0, Math.min(source.size, 16 * 1024)), parsed: undefined };
    }
    const size =
      10 + synchsafeToNumber(first, 6) + (first[3] === 4 && (first[5]! & 0x10) !== 0 ? 10 : 0);
    if (size > 8 * 1024 * 1024)
      return yield* Effect.fail(readFailure("ID3 tag exceeds the 8 MiB metadata safety limit."));
    const bytes = yield* source.read(0, Math.min(source.size, size + 16 * 1024));
    const parsed = yield* Effect.try({
      try: () => parseId3(bytes),
      catch: (cause) =>
        cause instanceof AudioMetadataReadError
          ? cause
          : readFailure("unable to parse ID3 metadata.", cause),
    });
    return { bytes, parsed };
  });

const readTail = (source: ByteSource) =>
  Effect.gen(function* () {
    const suffixLength = Math.min(source.size, 160);
    const suffix = yield* source.read(source.size - suffixLength, suffixLength);
    const hasId3v1 = ascii(suffix, suffix.length - 128, 3) === "TAG";
    const footerOffset = suffix.length - (hasId3v1 ? 160 : 32);
    if (footerOffset < 0 || ascii(suffix, footerOffset, 8) !== "APETAGEX") return suffix;
    const apeSize = readUint32LE(suffix, footerOffset + 12);
    if (apeSize < 32) return suffix;
    if (apeSize > 8 * 1024 * 1024) {
      return yield* Effect.fail(readFailure("APEv2 tag exceeds the 8 MiB metadata safety limit."));
    }
    const total = apeSize + (hasId3v1 ? 128 : 0);
    return yield* source.read(Math.max(0, source.size - total), Math.min(source.size, total));
  });

export const mp3Driver: FormatDriver = {
  format,
  inspect: (source) =>
    Effect.gen(function* () {
      const { bytes, parsed } = yield* readHead(source);
      const tail = yield* readTail(source);
      const v1 = parseId3v1(tail);
      const ape = yield* Effect.try({
        try: () => parseApe(tail),
        catch: (cause) =>
          cause instanceof AudioMetadataReadError
            ? cause
            : readFailure("unable to parse APEv2 metadata.", cause),
      });
      const get = (key: keyof typeof ids, apeKey: string = key): string | number | undefined => {
        const legacy = (v1 as Record<string, string | number | undefined>)[key];
        return firstText(parsed, ids[key]) ?? ape.values.get(apeKey.toLowerCase()) ?? legacy;
      };
      const yearText = String(get("year", "year") ?? "");
      const trackText = String(get("trackNumber", "track") ?? "");
      const pictures =
        parsed?.frames
          .filter((frame) => ids.picture.includes(frame.id as "APIC" | "PIC"))
          .map((frame) => parsePicture(frame, parsed.version))
          .filter((picture): picture is ArtworkEntry => Boolean(picture)) ?? [];
      let frameInfo: ReturnType<typeof getFrameInfo>;
      let audioFrameOffset = -1;
      const start = parsed?.end ?? 0;
      for (let offset = start; offset + 4 <= bytes.length; offset++) {
        frameInfo = getFrameInfo(bytes, offset);
        if (frameInfo) {
          audioFrameOffset = offset;
          break;
        }
      }
      if (!frameInfo)
        return yield* Effect.fail(readFailure("MP3 contains no valid MPEG audio frame."));
      const id3v1Size = ascii(tail, tail.length - 128, 3) === "TAG" ? 128 : 0;
      const audioBytes = Math.max(0, source.size - start - id3v1Size - ape.size);
      const vbrFrames = readVbrFrameCount(bytes, audioFrameOffset);
      if (!vbrFrames) {
        const observedBitrates = new Set<number>();
        let scanOffset = audioFrameOffset;
        while (scanOffset + 4 <= bytes.length) {
          const scanned = getFrameInfo(bytes, scanOffset);
          if (!scanned || scanOffset + scanned.frameLength > bytes.length) break;
          observedBitrates.add(scanned.bitrate);
          scanOffset += scanned.frameLength;
        }
        if (observedBitrates.size > 1) {
          return yield* Effect.fail(
            readFailure("VBR MP3 is missing a Xing/Info or VBRI frame count."),
          );
        }
      }
      const duration = vbrFrames
        ? (vbrFrames * frameInfo.samplesPerFrame) / frameInfo.sampleRate
        : frameInfo.bitrate > 0
          ? (audioBytes * 8) / frameInfo.bitrate
          : 0;
      const bitrate = duration > 0 ? Math.round((audioBytes * 8) / duration) : frameInfo.bitrate;
      const title = String(get("title") ?? "");
      const artist = String(get("artist") ?? "");
      const album = String(get("album") ?? "");
      const genreText = String(get("genre") ?? "");
      const genreValues = genreText.split("\0").filter(Boolean);
      const genre = genreValues.length > 1 ? genreValues : genreText;
      const trackTotalMatch = trackText.match(/^\s*\d+\s*\/\s*(\d+)/u);
      return {
        format,
        metadata: {
          title,
          artist,
          album,
          year: /^\s*\d{4}/u.test(yearText) ? Number.parseInt(yearText, 10) : null,
          genre,
          duration,
          bitrate,
          sampleRate: frameInfo.sampleRate,
          picture: pictures,
          trackNumber: /^\d+/u.test(trackText) ? Number.parseInt(trackText, 10) : null,
          trackTotal: trackTotalMatch ? Number.parseInt(trackTotalMatch[1]!, 10) : null,
        },
      };
    }).pipe(
      Effect.catchDefect((cause) =>
        Effect.fail(readFailure("unable to inspect MP3 metadata.", cause)),
      ),
      Effect.mapError((error) =>
        error instanceof AudioMetadataReadError
          ? error
          : readFailure("unable to inspect MP3 metadata.", error),
      ),
    ),
  patch: (source, changes) => {
    if (Object.keys(changes).length === 0) {
      return Effect.succeed({ parts: [source.slice()], type: format.mime });
    }
    return Effect.gen(function* () {
      const { parsed } = yield* readHead(source).pipe(
        Effect.mapError((error) => writeFailure(error.message, error)),
      );
      const tag = yield* Effect.try({
        try: () => buildTag(parsed, changes),
        catch: (cause) => writeFailure("unable to encode ID3 metadata.", cause),
      });
      return { parts: [tag, source.slice(parsed?.end ?? 0)], type: format.mime };
    }).pipe(
      Effect.mapError((error) =>
        error instanceof AudioMetadataWriteError
          ? error
          : writeFailure("unable to patch MP3 metadata.", error),
      ),
    );
  },
};
