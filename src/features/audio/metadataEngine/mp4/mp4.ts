import { Effect } from "effect";
import { AudioMetadataReadError, AudioMetadataWriteError } from "@/features/audio/audioErrors";
import type { ByteSource } from "@/features/audio/metadataEngine/byteSource";
import type { FormatDriver } from "@/features/audio/metadataEngine/driver";
import type {
  ArtworkEntry,
  AudioInspection,
  MetadataChanges,
  PatchPlan,
} from "@/features/audio/metadataEngine/types";

const FORMAT = { kind: "m4a", extension: "m4a", mime: "audio/mp4" } as const;
const MAX_ATOMS = 100_000;
const MAX_DEPTH = 24;
const READ_CHUNK = 1024 * 1024;
const MAX_MATERIALIZED_BYTES = 64 * 1024 * 1024;
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "udta", "meta", "ilst"]);

interface Atom {
  type: string;
  start: number;
  size: number;
  headerSize: 8 | 16;
  prefixSize: number;
  children?: Atom[];
}

interface ParsedMp4 {
  atoms: Atom[];
  moov: Atom;
  mdats: Atom[];
  duration: number;
  sampleRate: number;
  metadata: AudioInspection["metadata"];
}

const readError = (message: string, cause?: unknown) =>
  new AudioMetadataReadError({ message: `M4A: ${message}`, cause });
const writeError = (message: string, cause?: unknown) =>
  new AudioMetadataWriteError({ message: `M4A: ${message}`, cause });

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));
const u16 = (bytes: Uint8Array, offset: number) => bytes[offset]! * 0x100 + bytes[offset + 1]!;
const u32 = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! * 0x1000000 +
  bytes[offset + 1]! * 0x10000 +
  bytes[offset + 2]! * 0x100 +
  bytes[offset + 3]!;
const u64 = (bytes: Uint8Array, offset: number) => {
  const value = u32(bytes, offset) * 0x100000000 + u32(bytes, offset + 4);
  if (!Number.isSafeInteger(value)) throw readError("atom uses an unsupported 64-bit value.");
  return value;
};
const put16 = (value: number) => Uint8Array.of((value >>> 8) & 0xff, value & 0xff);
const put32 = (value: number) =>
  Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
const put64 = (value: number) => {
  const high = Math.floor(value / 0x100000000);
  return concat(put32(high), put32(value - high * 0x100000000));
};
const textBytes = (value: string) => new TextEncoder().encode(value);
const concat = (...chunks: Uint8Array[]) => {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};

const read = (source: ByteSource, offset: number, length: number, context: string) =>
  source
    .read(offset, length)
    .pipe(Effect.mapError((cause) => readError(`${context}: ${cause.message}`, cause)));

const parseAtoms = (
  source: ByteSource,
  start: number,
  end: number,
  depth = 0,
  counter = { value: 0 },
  parentType = "",
): Effect.Effect<Atom[], AudioMetadataReadError> =>
  Effect.gen(function* () {
    if (depth > MAX_DEPTH) return yield* Effect.fail(readError("atom nesting is too deep."));
    const atoms: Atom[] = [];
    let offset = start;
    while (offset < end) {
      if (++counter.value > MAX_ATOMS)
        return yield* Effect.fail(readError("atom count exceeds the safety limit."));
      if (end - offset < 8) return yield* Effect.fail(readError("truncated atom header."));
      const header = yield* read(
        source,
        offset,
        Math.min(16, end - offset),
        "unable to read atom header",
      );
      const size32 = u32(header, 0);
      const type = ascii(header, 4, 4);
      let headerSize: 8 | 16 = 8;
      let size = size32;
      if (size32 === 1) {
        if (header.length < 16)
          return yield* Effect.fail(readError(`truncated extended ${type} atom header.`));
        headerSize = 16;
        try {
          size = u64(header, 8);
        } catch (cause) {
          return yield* Effect.fail(cause as AudioMetadataReadError);
        }
      } else if (size32 === 0) {
        size = end - offset;
      }
      if (size < headerSize || offset + size > end) {
        return yield* Effect.fail(readError(`invalid or truncated ${type} atom.`));
      }
      const prefixSize = type === "meta" ? 4 : 0;
      const atom: Atom = { type, start: offset, size, headerSize, prefixSize };
      if (CONTAINERS.has(type) || parentType === "ilst") {
        const childStart = offset + headerSize + prefixSize;
        if (childStart > offset + size)
          return yield* Effect.fail(readError(`truncated ${type} atom.`));
        atom.children = yield* parseAtoms(
          source,
          childStart,
          offset + size,
          depth + 1,
          counter,
          type,
        );
      }
      atoms.push(atom);
      offset += size;
      if (size32 === 0 && offset !== end)
        return yield* Effect.fail(readError(`${type} atom with size zero is not last.`));
    }
    return atoms;
  });

const descendants = (atom: Atom, type: string): Atom[] => {
  const found: Atom[] = [];
  for (const child of atom.children ?? []) {
    if (child.type === type) found.push(child);
    found.push(...descendants(child, type));
  }
  return found;
};

const child = (atom: Atom, type: string) => atom.children?.find((entry) => entry.type === type);

const itunesMetadataPath = (moov: Atom) => {
  const udta = child(moov, "udta");
  const meta = udta && child(udta, "meta");
  const ilst = meta && child(meta, "ilst");
  return { udta, meta, ilst };
};

const readChunked = (source: ByteSource, offset: number, length: number, context: string) =>
  Effect.gen(function* () {
    if (length > MAX_MATERIALIZED_BYTES) {
      return yield* Effect.fail(
        readError(`${context}: payload exceeds the 64 MiB materialization limit.`),
      );
    }
    const result = new Uint8Array(length);
    for (let cursor = 0; cursor < length; cursor += READ_CHUNK) {
      const part = yield* read(
        source,
        offset + cursor,
        Math.min(READ_CHUNK, length - cursor),
        context,
      );
      result.set(part, cursor);
    }
    return result;
  });

const readFullAtom = (source: ByteSource, atom: Atom, context = atom.type) =>
  readChunked(source, atom.start, atom.size, `unable to read ${context} atom`);

const fullBoxTiming = (bytes: Uint8Array, headerSize: number) => {
  if (bytes.length < headerSize + 4) throw readError("timing box is truncated.");
  const version = bytes[headerSize]!;
  const requiredLength = headerSize + (version === 1 ? 32 : 20);
  if (bytes.length < requiredLength) throw readError("timing box is truncated.");
  const timescaleOffset = headerSize + (version === 1 ? 20 : 12);
  const durationOffset = timescaleOffset + 4;
  if (version !== 0 && version !== 1) throw readError("unsupported timing box version.");
  const timescale = u32(bytes, timescaleOffset);
  const duration = version === 1 ? u64(bytes, durationOffset) : u32(bytes, durationOffset);
  if (timescale === 0) throw readError("timing box has a zero timescale.");
  return duration / timescale;
};

const parseAudioTrack = (source: ByteSource, moov: Atom) =>
  Effect.gen(function* () {
    let selected: { mdhd: Atom; stsd: Atom } | undefined;
    for (const trak of moov.children?.filter((entry) => entry.type === "trak") ?? []) {
      const mdia = child(trak, "mdia");
      const hdlr = mdia && child(mdia, "hdlr");
      if (!mdia || !hdlr) continue;
      const handler = yield* readFullAtom(source, hdlr);
      if (handler.length < hdlr.headerSize + 12) {
        return yield* Effect.fail(readError("track handler is truncated."));
      }
      if (ascii(handler, hdlr.headerSize + 8, 4) !== "soun") {
        return yield* Effect.fail(
          readError("mixed audio/non-audio MP4 tracks are not currently supported."),
        );
      }
      const mdhd = child(mdia, "mdhd");
      const minf = child(mdia, "minf");
      const stbl = minf && child(minf, "stbl");
      const stsd = stbl && child(stbl, "stsd");
      if (!mdhd || !stsd)
        return yield* Effect.fail(readError("audio track is missing mdhd or stsd."));
      if (selected)
        return yield* Effect.fail(readError("multiple audio tracks are not currently supported."));
      selected = { mdhd, stsd };
    }
    if (!selected) return yield* Effect.fail(readError("container has no supported audio track."));

    const stsdBytes = yield* readFullAtom(source, selected.stsd);
    const base = selected.stsd.headerSize;
    if (stsdBytes.length < base + 16 || u32(stsdBytes, base + 4) < 1) {
      return yield* Effect.fail(readError("audio sample description is truncated."));
    }
    const entrySize = u32(stsdBytes, base + 8);
    const codec = ascii(stsdBytes, base + 12, 4);
    if (codec === "enca") return yield* Effect.fail(readError("encrypted audio is not supported."));
    if (codec !== "mp4a" && codec !== "alac") {
      return yield* Effect.fail(readError(`unsupported audio codec ${JSON.stringify(codec)}.`));
    }
    if (entrySize < 36 || base + 8 + entrySize > stsdBytes.length) {
      return yield* Effect.fail(readError("audio sample entry is truncated."));
    }
    const sampleRate = u32(stsdBytes, base + 8 + 32) / 0x10000;
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      return yield* Effect.fail(readError("audio sample rate is invalid."));
    }
    const mdhdBytes = yield* readFullAtom(source, selected.mdhd);
    let duration: number;
    try {
      duration = fullBoxTiming(mdhdBytes, selected.mdhd.headerSize);
    } catch (cause) {
      return yield* Effect.fail(cause as AudioMetadataReadError);
    }
    return { duration, sampleRate };
  });

const validateDataReferences = (source: ByteSource, moov: Atom) =>
  Effect.gen(function* () {
    for (const dinf of descendants(moov, "dinf")) {
      const bytes = yield* readFullAtom(source, dinf);
      let offset = dinf.headerSize;
      while (offset < bytes.length) {
        if (offset + 8 > bytes.length) {
          return yield* Effect.fail(readError("data information atom is truncated."));
        }
        const size = u32(bytes, offset);
        const type = ascii(bytes, offset + 4, 4);
        if (size < 8 || offset + size > bytes.length) {
          return yield* Effect.fail(readError("invalid data information child atom."));
        }
        if (type === "dref") {
          if (size < 16) return yield* Effect.fail(readError("data reference atom is truncated."));
          const entryCount = u32(bytes, offset + 12);
          let entryOffset = offset + 16;
          for (let index = 0; index < entryCount; index++) {
            if (entryOffset + 12 > offset + size) {
              return yield* Effect.fail(readError("data reference entry is truncated."));
            }
            const entrySize = u32(bytes, entryOffset);
            const entryType = ascii(bytes, entryOffset + 4, 4);
            if (entrySize < 12 || entryOffset + entrySize > offset + size) {
              return yield* Effect.fail(readError("invalid data reference entry."));
            }
            const flags =
              bytes[entryOffset + 9]! * 0x10000 +
              bytes[entryOffset + 10]! * 0x100 +
              bytes[entryOffset + 11]!;
            if ((entryType === "url " || entryType === "urn ") && (flags & 1) === 0) {
              return yield* Effect.fail(
                readError("external media data references are not supported."),
              );
            }
            entryOffset += entrySize;
          }
          if (entryOffset !== offset + size) {
            return yield* Effect.fail(
              readError("data reference entry count does not match its atom."),
            );
          }
        }
        offset += size;
      }
    }
  });

const itemDataAtoms = (item: Atom) => item.children?.filter((entry) => entry.type === "data") ?? [];

const dataPayload = (source: ByteSource, atom: Atom) =>
  Effect.gen(function* () {
    const prefixLength = atom.type === "data" ? 8 : 4;
    if (atom.size < atom.headerSize + prefixLength) {
      return yield* Effect.fail(readError(`truncated ilst ${atom.type} atom.`));
    }
    const prefix = yield* read(
      source,
      atom.start + atom.headerSize,
      prefixLength,
      `unable to read ilst ${atom.type} prefix`,
    );
    const payloadOffset = atom.start + atom.headerSize + prefixLength;
    const bytes = yield* readChunked(
      source,
      payloadOffset,
      atom.start + atom.size - payloadOffset,
      `unable to read ilst ${atom.type} payload`,
    );
    return {
      type: atom.type === "data" ? u32(prefix, 0) & 0xffffff : 1,
      locale: atom.type === "data" ? u32(prefix, 4) : 0,
      bytes,
    };
  });

const decodeUtf8 = (bytes: Uint8Array) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw readError("invalid UTF-8 in ilst text metadata.", cause);
  }
};

const decodeUtf16 = (bytes: Uint8Array) => {
  if (bytes.length % 2 !== 0) throw readError("invalid UTF-16 in ilst text metadata.");
  let offset = bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0;
  const units: number[] = [];
  for (; offset < bytes.length; offset += 2)
    units.push(bytes[offset]! * 0x100 + bytes[offset + 1]!);
  let output = "";
  for (let index = 0; index < units.length; index += 8192) {
    output += String.fromCharCode(...units.slice(index, index + 8192));
  }
  return output;
};

const parseMetadata = (
  source: ByteSource,
  moov: Atom,
  duration: number,
  sampleRate: number,
  mdats: Atom[],
) =>
  Effect.gen(function* () {
    const { ilst } = itunesMetadataPath(moov);
    const values = new Map<string, string[]>();
    const freeform = new Map<string, string[]>();
    const pictures: ArtworkEntry[] = [];
    let trackNumber: number | null = null;
    let trackTotal: number | null = null;
    let retainedMetadataBytes = 0;
    const knownTextItems = new Set(["©nam", "©ART", "©alb", "©day", "©gen", "gnre"]);
    const knownFreeformItems = new Set(["TITLE", "ARTIST", "ALBUM", "DATE", "GENRE"]);
    for (const item of ilst?.children ?? []) {
      if (item.type === "----") {
        let name = "";
        const itemPayloads: Array<{ type: number; bytes: Uint8Array<ArrayBuffer> }> = [];
        for (const entry of item.children ?? []) {
          const payload = yield* dataPayload(source, entry);
          retainedMetadataBytes += payload.bytes.length;
          if (retainedMetadataBytes > MAX_MATERIALIZED_BYTES) {
            return yield* Effect.fail(
              readError("aggregate ilst metadata exceeds the 64 MiB safety limit."),
            );
          }
          if (entry.type === "name") {
            try {
              name = decodeUtf8(payload.bytes).toUpperCase();
            } catch {
              name = "";
            }
          }
          if (entry.type === "data") itemPayloads.push(payload);
        }
        if (knownFreeformItems.has(name)) {
          const itemValues: string[] = [];
          for (const payload of itemPayloads) {
            if (payload.type === 1) {
              itemValues.push(decodeUtf8(payload.bytes));
            }
          }
          if (itemValues.length) freeform.set(name, itemValues);
        }
        continue;
      }
      if (item.type !== "covr" && item.type !== "trkn" && !knownTextItems.has(item.type)) {
        continue;
      }
      for (const entry of itemDataAtoms(item)) {
        const payload = yield* dataPayload(source, entry);
        retainedMetadataBytes += payload.bytes.length;
        if (retainedMetadataBytes > MAX_MATERIALIZED_BYTES) {
          return yield* Effect.fail(
            readError("aggregate ilst metadata exceeds the 64 MiB safety limit."),
          );
        }
        if (item.type === "covr") {
          pictures.push({
            format:
              payload.type === 14
                ? "image/png"
                : payload.type === 13
                  ? "image/jpeg"
                  : "application/octet-stream",
            type: 3,
            description: "",
            data: new Uint8Array(payload.bytes),
            dataType: payload.type,
            dataLocale: payload.locale,
            opaqueData: concat(put32(payload.type), put32(payload.locale), payload.bytes),
          });
        } else if (item.type === "trkn") {
          if (payload.bytes.length >= 6) {
            trackNumber ??= u16(payload.bytes, 2) || null;
            trackTotal ??= u16(payload.bytes, 4) || null;
          }
        } else if (item.type === "gnre") {
          if (payload.bytes.length >= 2) {
            const current = values.get("gnre") ?? [];
            current.push(String(Math.max(0, u16(payload.bytes, 0) - 1)));
            values.set("gnre", current);
          }
        } else {
          if (payload.type !== 1 && payload.type !== 2) continue;
          let decoded: string;
          try {
            decoded = payload.type === 2 ? decodeUtf16(payload.bytes) : decodeUtf8(payload.bytes);
          } catch (cause) {
            return yield* Effect.fail(cause as AudioMetadataReadError);
          }
          const current = values.get(item.type) ?? [];
          current.push(decoded);
          values.set(item.type, current);
        }
      }
    }
    const first = (direct: string, fallback: string) =>
      values.get(direct)?.[0] ?? freeform.get(fallback)?.[0] ?? "";
    const genres = values.get("©gen") ?? values.get("gnre") ?? freeform.get("GENRE") ?? [];
    const date = first("©day", "DATE");
    const audioBytes = mdats.reduce((sum, atom) => sum + atom.size - atom.headerSize, 0);
    return {
      title: first("©nam", "TITLE"),
      artist: first("©ART", "ARTIST"),
      album: first("©alb", "ALBUM"),
      year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
      genre: genres.length <= 1 ? (genres[0] ?? "") : genres,
      duration,
      bitrate: duration > 0 ? Math.round((audioBytes * 8) / duration) : 0,
      sampleRate,
      picture: pictures,
      trackNumber,
      trackTotal,
    } satisfies AudioInspection["metadata"];
  });

const parse = (source: ByteSource): Effect.Effect<ParsedMp4, AudioMetadataReadError> =>
  Effect.gen(function* () {
    if (source.size < 16)
      return yield* Effect.fail(readError("file is too small to be an MP4 container."));
    const atoms = yield* parseAtoms(source, 0, source.size);
    const ftyp = atoms.find((atom) => atom.type === "ftyp");
    const moov = atoms.find((atom) => atom.type === "moov");
    const mdats = atoms.filter((atom) => atom.type === "mdat");
    if (!ftyp || !moov || mdats.length === 0) {
      return yield* Effect.fail(readError("container must contain ftyp, moov, and mdat atoms."));
    }
    if (atoms.some((atom) => atom.type === "moof") || child(moov, "mvex")) {
      return yield* Effect.fail(readError("fragmented MP4 files are not supported."));
    }
    const ftypBytes = yield* readFullAtom(source, ftyp);
    if (ftypBytes.length < ftyp.headerSize + 8)
      return yield* Effect.fail(readError("ftyp atom is truncated."));
    const { duration, sampleRate } = yield* parseAudioTrack(source, moov);
    yield* validateDataReferences(source, moov);
    const metadata = yield* parseMetadata(source, moov, duration, sampleRate, mdats);
    return { atoms, moov, mdats, duration, sampleRate, metadata };
  });

const atomHeader = (type: string, size: number, extended = false) => {
  const typePart = Uint8Array.from(type, (character) => character.charCodeAt(0));
  return extended ? concat(put32(1), typePart, put64(size)) : concat(put32(size), typePart);
};

const makeAtom = (type: string, payloadParts: BlobPart[], extended = false) => {
  const payload = new Blob(payloadParts);
  const useExtended = extended || payload.size + 8 > 0xffffffff;
  const headerSize = useExtended ? 16 : 8;
  return new Blob([atomHeader(type, payload.size + headerSize, useExtended), payload]);
};

const makeData = (payload: Uint8Array<ArrayBuffer>, type: number, locale = 0) =>
  makeAtom("data", [put32(type), put32(locale), payload]);
const makeTextItem = (type: string, values: string[]) =>
  makeAtom(
    type,
    values.map((value) => makeData(textBytes(value), 1)),
  );
const makeTrackItem = (value: number, total: number | null | undefined) =>
  makeAtom("trkn", [makeData(concat(put16(0), put16(value), put16(total ?? 0), put16(0)), 0)]);
const makeArtworkItem = (pictures: ArtworkEntry[]) =>
  makeAtom(
    "covr",
    pictures.map((picture) =>
      picture.opaqueData
        ? makeAtom("data", [picture.opaqueData])
        : makeData(
            picture.data,
            picture.dataType ?? (picture.format === "image/png" ? 14 : 13),
            picture.dataLocale,
          ),
    ),
  );

const replacementEntries = (changes: MetadataChanges, trackTotal?: number | null) => {
  const result = new Map<string, Blob | null>();
  const text = (type: string, value: string | undefined) => {
    if (value !== undefined) result.set(type, value === "" ? null : makeTextItem(type, [value]));
  };
  text("©nam", changes.title);
  text("©ART", changes.artist);
  text("©alb", changes.album);
  if (changes.year !== undefined)
    result.set("©day", changes.year === null ? null : makeTextItem("©day", [String(changes.year)]));
  if (changes.genre !== undefined) {
    const genres = Array.isArray(changes.genre) ? changes.genre : [changes.genre];
    const nonempty = genres.filter(Boolean);
    result.set("©gen", nonempty.length ? makeTextItem("©gen", nonempty) : null);
  }
  if (changes.trackNumber !== undefined) {
    result.set(
      "trkn",
      changes.trackNumber === null ? null : makeTrackItem(changes.trackNumber, trackTotal),
    );
  }
  if (changes.picture !== undefined)
    result.set("covr", changes.picture.length ? makeArtworkItem(changes.picture) : null);
  return result;
};

const hasChanges = (changes: MetadataChanges) =>
  Object.values(changes).some((value) => value !== undefined);

const offsetPayload = (
  source: ByteSource,
  atom: Atom,
  delta: number,
  moovEnd: number,
  mdats: Atom[],
) =>
  Effect.gen(function* () {
    const bytes = yield* readFullAtom(source, atom);
    const base = atom.headerSize;
    if (bytes.length < base + 8)
      return yield* Effect.fail(readError(`truncated ${atom.type} atom.`));
    const count = u32(bytes, base + 4);
    const width = atom.type === "co64" ? 8 : 4;
    if (base + 8 + count * width !== bytes.length)
      return yield* Effect.fail(readError(`invalid ${atom.type} table length.`));
    const offsets: number[] = [];
    let needs64 = atom.type === "co64";
    for (let index = 0; index < count; index++) {
      const value =
        width === 8 ? u64(bytes, base + 8 + index * width) : u32(bytes, base + 8 + index * width);
      if (
        !mdats.some(
          (mdat) => value >= mdat.start + mdat.headerSize && value < mdat.start + mdat.size,
        )
      ) {
        return yield* Effect.fail(readError(`${atom.type} points outside media data.`));
      }
      const shifted = value >= moovEnd ? value + delta : value;
      if (!Number.isSafeInteger(shifted) || shifted < 0)
        return yield* Effect.fail(readError("chunk offset overflow."));
      needs64 ||= shifted > 0xffffffff;
      offsets.push(shifted);
    }
    const payload = [
      bytes.subarray(base, base + 8),
      ...offsets.map((value) => (needs64 ? put64(value) : put32(value))),
    ];
    return makeAtom(needs64 ? "co64" : "stco", payload);
  });

interface BuildContext {
  replacements: Map<string, Blob | null>;
  delta: number;
  moov: Atom;
  mdats: Atom[];
  targetIlstStart?: number;
  targetMetaStart?: number;
  targetUdtaStart?: number;
}

const handlerAtom = () =>
  makeAtom("hdlr", [
    concat(
      put32(0),
      put32(0),
      textBytes("mdir"),
      textBytes("appl"),
      put32(0),
      put32(0),
      put32(0),
      Uint8Array.of(0),
    ),
  ]);

const newIlst = (replacements: Map<string, Blob | null>) =>
  makeAtom(
    "ilst",
    [...replacements.values()].filter((entry): entry is Blob => entry !== null),
  );

const buildAtom = (
  source: ByteSource,
  atom: Atom,
  context: BuildContext,
): Effect.Effect<Blob, AudioMetadataReadError> =>
  Effect.gen(function* () {
    if (atom.type === "stco" || atom.type === "co64") {
      return yield* offsetPayload(
        source,
        atom,
        context.delta,
        context.moov.start + context.moov.size,
        context.mdats,
      );
    }
    if (atom.type === "ilst") {
      if (atom.start !== context.targetIlstStart) {
        return source.slice(atom.start, atom.start + atom.size);
      }
      const emitted = new Set<string>();
      const parts: BlobPart[] = [];
      for (const item of atom.children ?? []) {
        const replacement = context.replacements.get(item.type);
        if (replacement !== undefined || context.replacements.has(item.type)) {
          if (!emitted.has(item.type) && replacement) parts.push(replacement);
          emitted.add(item.type);
        } else {
          parts.push(source.slice(item.start, item.start + item.size));
        }
      }
      for (const [type, replacement] of context.replacements) {
        if (!emitted.has(type) && replacement) parts.push(replacement);
      }
      return makeAtom("ilst", parts, atom.headerSize === 16);
    }
    if (!atom.children) return source.slice(atom.start, atom.start + atom.size);
    const parts: BlobPart[] = [];
    if (atom.prefixSize)
      parts.push(
        source.slice(atom.start + atom.headerSize, atom.start + atom.headerSize + atom.prefixSize),
      );
    for (const entry of atom.children) parts.push(yield* buildAtom(source, entry, context));
    if (atom.start === context.targetMetaStart && context.targetIlstStart === undefined) {
      parts.push(newIlst(context.replacements));
    }
    if (atom.start === context.targetUdtaStart && context.targetMetaStart === undefined) {
      parts.push(makeAtom("meta", [put32(0), handlerAtom(), newIlst(context.replacements)]));
    }
    if (atom.type === "moov" && context.targetUdtaStart === undefined) {
      parts.push(
        makeAtom("udta", [
          makeAtom("meta", [put32(0), handlerAtom(), newIlst(context.replacements)]),
        ]),
      );
    }
    return makeAtom(atom.type, parts, atom.headerSize === 16);
  });

const buildMoov = (
  source: ByteSource,
  parsed: ParsedMp4,
  replacements: Map<string, Blob | null>,
  delta: number,
) => {
  const metadataPath = itunesMetadataPath(parsed.moov);
  const context: BuildContext = {
    replacements,
    delta,
    moov: parsed.moov,
    mdats: parsed.mdats,
    targetIlstStart: metadataPath.ilst?.start,
    targetMetaStart: metadataPath.meta?.start,
    targetUdtaStart: metadataPath.udta?.start,
  };
  return buildAtom(source, parsed.moov, context);
};

const inspect = (source: ByteSource) =>
  parse(source).pipe(Effect.map((parsed) => ({ format: FORMAT, metadata: parsed.metadata })));

const patch = (
  source: ByteSource,
  changes: MetadataChanges,
): Effect.Effect<PatchPlan, AudioMetadataWriteError> =>
  Effect.gen(function* () {
    const parsed = yield* parse(source).pipe(
      Effect.mapError((cause) => writeError("cannot patch an invalid container.", cause)),
    );
    if (!hasChanges(changes)) return { parts: [source.slice()], type: FORMAT.mime };
    const replacements = replacementEntries(changes, parsed.metadata.trackTotal);
    let delta = 0;
    let moov = yield* buildMoov(source, parsed, replacements, delta).pipe(
      Effect.mapError((cause) => writeError("unable to plan metadata rewrite.", cause)),
    );
    for (let pass = 0; pass < 3; pass++) {
      const nextDelta = moov.size - parsed.moov.size;
      if (nextDelta === delta) break;
      delta = nextDelta;
      moov = yield* buildMoov(source, parsed, replacements, delta).pipe(
        Effect.mapError((cause) => writeError("unable to update media chunk offsets.", cause)),
      );
    }
    if (moov.size - parsed.moov.size !== delta) {
      return yield* Effect.fail(writeError("chunk offset layout did not converge."));
    }
    const parts: BlobPart[] = [];
    let cursor = 0;
    for (const atom of parsed.atoms) {
      if (cursor < atom.start) parts.push(source.slice(cursor, atom.start));
      parts.push(atom === parsed.moov ? moov : source.slice(atom.start, atom.start + atom.size));
      cursor = atom.start + atom.size;
    }
    if (cursor < source.size) parts.push(source.slice(cursor));
    return { parts, type: FORMAT.mime };
  });

export const mp4Driver = { format: FORMAT, inspect, patch } satisfies FormatDriver;
