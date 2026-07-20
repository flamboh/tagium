import { ascii, concat, sha256, synchsafe, u24be, u32be, u32le } from "./bytes";
import { audioPayloadSha256 } from "./structural";
import type { CanonicalFixtureMetadata, FixtureCase, FixtureFamily } from "./types";

const FAMILY_CASES = 180;
export const DEFAULT_CORPUS_SEED = 0x5441_4749;

const strings = [
  "Plain title",
  "Café déjà vu",
  "東京の夜 🎧",
  "مرحبا بالعالم",
  "שלום עולם",
  `long-${"metadata-".repeat(256)}`,
] as const;

const canonicalFor = (index: number): CanonicalFixtureMetadata => ({
  title: strings[index % strings.length]!,
  artist: `Artist ${index % 17}`,
  album: `Synthetic Album ${index % 11}`,
  date: index % 4 === 0 ? "2024-07-19" : String(1980 + (index % 45)),
  genres: index % 3 === 0 ? ["Electronic", "Ambient"] : ["Test"],
  trackNumber: (index % 30) + 1,
  artworkCount: index === 176 ? 2 : index % 6 === 0 ? 2 : index % 3 === 0 ? 1 : 0,
});

const syntheticImage = (index: number, prefix: Uint8Array) => {
  const length = index === 176 ? 1024 * 1024 : 4;
  const payload = new Uint8Array(length);
  for (let offset = 0; offset < payload.length; offset++) {
    payload[offset] = (index * 17 + offset * 31) & 0xff;
  }
  return concat(prefix, payload);
};

const emptyCanonical = (): CanonicalFixtureMetadata => ({
  title: "",
  artist: "",
  album: "",
  date: "",
  genres: [],
  trackNumber: null,
  artworkCount: 0,
});

const id3v1Canonical = (metadata: CanonicalFixtureMetadata): CanonicalFixtureMetadata => ({
  ...metadata,
  title: metadata.title.replace(/[^\x20-\x7e]/gu, "?").slice(0, 30),
  artist: metadata.artist.slice(0, 30),
  album: metadata.album.slice(0, 30),
  date: metadata.date.slice(0, 4),
  genres: ["12"],
  artworkCount: 0,
});

const utf16le = (value: string) => {
  const output = new Uint8Array(2 + value.length * 2);
  output.set([0xff, 0xfe]);
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    output[2 + index * 2] = code & 0xff;
    output[3 + index * 2] = code >>> 8;
  }
  return output;
};

const utf16be = (value: string) => {
  const output = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    output[index * 2] = code >>> 8;
    output[index * 2 + 1] = code & 0xff;
  }
  return output;
};

const id3Text = (value: string, encoding: number) => {
  if (encoding === 0) {
    const latin = Array.from(value, (character) => {
      const code = character.charCodeAt(0);
      return code === 0 || (code >= 0x20 && code <= 0x7e) ? character : "?";
    }).join("");
    return concat(Uint8Array.of(0), ascii(latin));
  }
  if (encoding === 1) return concat(Uint8Array.of(1), utf16le(value));
  if (encoding === 2) return concat(Uint8Array.of(2), utf16be(value));
  return concat(Uint8Array.of(3), new TextEncoder().encode(value));
};

const id3Frame = (id: string, payload: Uint8Array, version: 2 | 3 | 4) => {
  if (version === 2) {
    return concat(ascii(id), u24be(payload.length), payload);
  }
  return concat(
    ascii(id),
    version === 4 ? synchsafe(payload.length) : u32be(payload.length),
    Uint8Array.of(0, 0),
    payload,
  );
};

const id3Picture = (index: number, version: 2 | 3 | 4) => {
  const image = syntheticImage(index, ascii("\x89PNG\r\n\x1a\n"));
  const payload =
    version === 2
      ? concat(Uint8Array.of(0), ascii("PNG"), Uint8Array.of(3, 0), image)
      : concat(Uint8Array.of(0), ascii("image/png"), Uint8Array.of(0, 3, 0), image);
  return id3Frame(version === 2 ? "PIC" : "APIC", payload, version);
};

const unsynchroniseId3 = (bytes: Uint8Array) => {
  const output: number[] = [];
  for (let index = 0; index < bytes.length; index++) {
    const value = bytes[index]!;
    output.push(value);
    const next = bytes[index + 1];
    if (value === 0xff && (next === undefined || next === 0 || next >= 0xe0)) output.push(0);
  }
  return Uint8Array.from(output);
};

const apeTag = (index: number) => {
  const value = ascii(`opaque-${index}`);
  const item = concat(
    u32le(value.length),
    u32le(0),
    ascii("TAGIUM_PRIVATE"),
    Uint8Array.of(0),
    value,
  );
  const footer = concat(
    ascii("APETAGEX"),
    u32le(2000),
    u32le(item.length + 32),
    u32le(1),
    u32le(0),
    new Uint8Array(8),
  );
  return concat(item, footer);
};

const id3v1 = (metadata: CanonicalFixtureMetadata) => {
  const output = new Uint8Array(128);
  output.set(ascii("TAG"));
  const put = (offset: number, length: number, value: string) =>
    output.set(ascii(value).slice(0, length), offset);
  put(3, 30, metadata.title);
  put(33, 30, metadata.artist);
  put(63, 30, metadata.album);
  put(93, 4, metadata.date.slice(0, 4));
  output[125] = 0;
  output[126] = metadata.trackNumber ?? 0;
  output[127] = 12;
  return output;
};

const mpegAudio = (index: number) => {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  for (let offset = 4; offset < frame.length; offset++)
    frame[offset] = (offset * 31 + index) & 0xff;
  return concat(frame, frame);
};

const mp3Variants = ["id3v1", "id3v2.2", "id3v2.3", "id3v2.4+apev2", "no-tag"] as const;

const makeMp3 = (index: number, malformed: boolean) => {
  const metadata = canonicalFor(index);
  let writtenMetadata = metadata;
  const variant = mp3Variants[index % mp3Variants.length]!;
  const audio = mpegAudio(index);
  let bytes: Uint8Array;
  if (variant === "no-tag") bytes = audio;
  else if (variant === "id3v1") bytes = concat(audio, id3v1(id3v1Canonical(metadata)));
  else {
    const version = variant.includes("2.2") ? 2 : variant.includes("2.3") ? 3 : 4;
    const encoding = index % (version === 2 || version === 3 ? 2 : 4);
    if (encoding === 0) {
      writtenMetadata = {
        ...metadata,
        title: metadata.title.replace(/[^\x20-\x7e]/gu, "?"),
        artist: metadata.artist.replace(/[^\x20-\x7e]/gu, "?"),
        album: metadata.album.replace(/[^\x20-\x7e]/gu, "?"),
      };
    }
    const genreText = metadata.genres.join(version === 4 ? "\0" : ";");
    if (version !== 4 && metadata.genres.length > 1) {
      writtenMetadata = { ...writtenMetadata, genres: [genreText] };
    }
    const ids =
      version === 2
        ? { title: "TT2", artist: "TP1", album: "TAL", year: "TYE", genre: "TCO", track: "TRK" }
        : {
            title: "TIT2",
            artist: "TPE1",
            album: "TALB",
            year: version === 4 ? "TDRC" : "TYER",
            genre: "TCON",
            track: "TRCK",
          };
    const frames = [
      id3Frame(ids.title, id3Text(metadata.title, encoding), version),
      id3Frame(ids.artist, id3Text(metadata.artist, encoding), version),
      id3Frame(ids.album, id3Text(metadata.album, encoding), version),
      id3Frame(ids.year, id3Text(metadata.date, encoding), version),
      id3Frame(ids.genre, id3Text(genreText, encoding), version),
      id3Frame(ids.track, id3Text(String(metadata.trackNumber), encoding), version),
      id3Frame(version === 2 ? "XXX" : "PRIV", ascii(`private-${index}`), version),
    ];
    if (index % 4 === 0)
      frames.push(id3Frame(ids.title, id3Text("duplicate title", encoding), version));
    for (let picture = 0; picture < metadata.artworkCount; picture++)
      frames.push(id3Picture(index + picture, version));
    const frameBody = concat(...frames, new Uint8Array(index % 29));
    const hasExtendedHeader = version >= 3 && index % 20 === (version === 3 ? 2 : 3);
    const hasFooter = version === 4 && index % 40 === 23;
    const hasUnsynchronisation = version >= 3 && (index % 40 === 7 || index % 40 === 23);
    const extendedHeader = hasExtendedHeader
      ? version === 3
        ? concat(u32be(6), new Uint8Array(6))
        : concat(synchsafe(6), Uint8Array.of(1, 0))
      : new Uint8Array();
    const logicalBody = concat(extendedHeader, frameBody);
    const body = hasUnsynchronisation ? unsynchroniseId3(logicalBody) : logicalBody;
    const flags =
      (hasExtendedHeader ? 0x40 : 0) | (hasFooter ? 0x10 : 0) | (hasUnsynchronisation ? 0x80 : 0);
    const footer = hasFooter
      ? concat(ascii("3DI"), Uint8Array.of(version, 0, flags), synchsafe(body.length))
      : new Uint8Array();
    const tag = concat(
      ascii("ID3"),
      Uint8Array.of(version, 0, flags),
      synchsafe(body.length),
      body,
      footer,
    );
    bytes = concat(
      tag,
      audio,
      variant.endsWith("apev2") ? apeTag(index) : new Uint8Array(),
      index % 7 === 0 ? id3v1(metadata) : new Uint8Array(),
    );
  }
  if (malformed) {
    const mode = index % 3;
    if (mode === 0) bytes = bytes.slice(0, 1);
    else if (mode === 1) bytes = concat(ascii("%PDF-renamed.mp3"), bytes.slice(0, 24));
    else
      bytes = concat(
        ascii("ID3"),
        Uint8Array.of(4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f),
        bytes.slice(10, 30),
      );
  }
  const expectedMetadata =
    variant === "no-tag"
      ? emptyCanonical()
      : variant === "id3v1"
        ? id3v1Canonical(metadata)
        : writtenMetadata;
  return { bytes, variant, metadata: expectedMetadata };
};

const flacBlock = (type: number, last: boolean, body: Uint8Array) =>
  concat(Uint8Array.of(type | (last ? 0x80 : 0)), u24be(body.length), body);

const streamInfo = () => {
  const body = new Uint8Array(34);
  body.set([0x10, 0x00, 0x10, 0x00], 0);
  const packed = (44_100n << 44n) | (1n << 41n) | (15n << 36n) | 88_200n;
  for (let index = 0; index < 8; index++)
    body[10 + index] = Number((packed >> BigInt((7 - index) * 8)) & 0xffn);
  return body;
};

const vorbis = (metadata: CanonicalFixtureMetadata, index: number) => {
  const vendor = ascii("Tagium synthetic conformance");
  const values = [
    `TITLE=${metadata.title}`,
    `ARTIST=${metadata.artist}`,
    `ALBUM=${metadata.album}`,
    `DATE=${metadata.date}`,
    ...metadata.genres.map((genre) => `GENRE=${genre}`),
    `TRACKNUMBER=${metadata.trackNumber}`,
    `X-TAGIUM-OPAQUE=${index}`,
  ];
  if (index % 4 === 0) values.push("TITLE=duplicate title", "REPLAYGAIN_TRACK_GAIN=-3.14 dB");
  return concat(
    u32le(vendor.length),
    vendor,
    u32le(values.length),
    ...values.map((value) => {
      const bytes = new TextEncoder().encode(value);
      return concat(u32le(bytes.length), bytes);
    }),
  );
};

const flacPicture = (index: number) => {
  const mime = ascii("image/png");
  const description = new TextEncoder().encode(`Cover ${index}`);
  const image = syntheticImage(index, ascii("\x89PNG\r\n\x1a\n"));
  return concat(
    u32be(3),
    u32be(mime.length),
    mime,
    u32be(description.length),
    description,
    u32be(1),
    u32be(1),
    u32be(24),
    u32be(0),
    u32be(image.length),
    image,
  );
};

const flacAudio = (index: number) =>
  concat(Uint8Array.of(0xff, 0xf8, 0x69, 0x18), new Uint8Array(124).fill(index & 0xff));
const flacVariants = ["comments", "pictures", "unknown-block", "no-comments", "padding"] as const;

const makeFlac = (index: number, malformed: boolean) => {
  const metadata = canonicalFor(index);
  const variant = flacVariants[index % flacVariants.length]!;
  const optional: Uint8Array[] = [];
  if (variant !== "no-comments") optional.push(flacBlock(4, false, vorbis(metadata, index)));
  if (variant === "pictures") {
    for (let picture = 0; picture < Math.max(1, metadata.artworkCount); picture++)
      optional.push(flacBlock(6, false, flacPicture(index + picture)));
  }
  if (variant === "unknown-block")
    optional.push(flacBlock(10, false, ascii(`opaque-block-${index}`)));
  if (variant === "padding") optional.push(flacBlock(1, false, new Uint8Array(257)));
  const blocks = [flacBlock(0, optional.length === 0, streamInfo()), ...optional];
  if (optional.length > 0) {
    const last = blocks.at(-1)!;
    last[0] = last[0]! | 0x80;
  }
  let bytes = concat(ascii("fLaC"), ...blocks, flacAudio(index));
  if (malformed) {
    const mode = index % 3;
    if (mode === 0) bytes = bytes.slice(0, 17);
    else if (mode === 1) bytes = concat(ascii("RIFFrenamed.flac"), bytes.slice(0, 32));
    else bytes[4] = 0xff;
  }
  return {
    bytes,
    variant,
    metadata:
      variant === "no-comments"
        ? emptyCanonical()
        : {
            ...metadata,
            artworkCount: variant === "pictures" ? Math.max(1, metadata.artworkCount) : 0,
          },
  };
};

const atomType = (type: string) =>
  type === "©nam"
    ? Uint8Array.of(0xa9, 0x6e, 0x61, 0x6d)
    : type === "©ART"
      ? Uint8Array.of(0xa9, 0x41, 0x52, 0x54)
      : type === "©alb"
        ? Uint8Array.of(0xa9, 0x61, 0x6c, 0x62)
        : type === "©day"
          ? Uint8Array.of(0xa9, 0x64, 0x61, 0x79)
          : type === "©gen"
            ? Uint8Array.of(0xa9, 0x67, 0x65, 0x6e)
            : ascii(type);
const atom = (type: string, ...body: readonly Uint8Array[]) => {
  const payload = concat(...body);
  return concat(u32be(payload.length + 8), atomType(type), payload);
};
const dataAtom = (value: Uint8Array, kind = 1) => atom("data", u32be(kind), u32be(0), value);

const ilst = (metadata: CanonicalFixtureMetadata, index: number) => {
  const items = [
    atom("©nam", dataAtom(new TextEncoder().encode(metadata.title))),
    atom("©ART", dataAtom(new TextEncoder().encode(metadata.artist))),
    atom("©alb", dataAtom(new TextEncoder().encode(metadata.album))),
    atom("©day", dataAtom(new TextEncoder().encode(metadata.date))),
    ...metadata.genres.map((genre) => atom("©gen", dataAtom(new TextEncoder().encode(genre)))),
    atom("trkn", dataAtom(Uint8Array.of(0, 0, 0, metadata.trackNumber ?? 0, 0, 30, 0, 0), 0)),
    atom(
      "----",
      atom("mean", u32be(0), ascii("com.apple.iTunes")),
      atom("name", u32be(0), ascii("TAGIUM_PRIVATE")),
      dataAtom(ascii(`opaque-${index}`)),
    ),
  ];
  if (index % 4 === 0) items.push(atom("©nam", dataAtom(ascii("duplicate title"))));
  for (let picture = 0; picture < metadata.artworkCount; picture++) {
    items.push(atom("covr", dataAtom(syntheticImage(index + picture, ascii("\x89PNG")), 14)));
  }
  return atom("ilst", ...items);
};

const mp4Audio = (index: number) =>
  new Uint8Array(256).map((_, offset) => (offset * 17 + index) & 0xff);
const mp4Variants = ["aac-ilst", "alac-ilst", "freeform", "unknown-atom", "multiple-mdat"] as const;

const audioTrack = (codec: string) => {
  const mdhd = atom(
    "mdhd",
    u32be(0),
    u32be(0),
    u32be(0),
    u32be(44_100),
    u32be(88_200),
    Uint8Array.of(0, 0, 0, 0),
  );
  const hdlr = atom("hdlr", u32be(0), u32be(0), ascii("soun"), new Uint8Array(12));
  const sampleEntry = new Uint8Array(28);
  sampleEntry.set([0, 1], 6);
  sampleEntry.set([0, 2, 0, 16], 16);
  sampleEntry.set(u32be(44_100 * 0x1_0000), 24);
  const stsd = atom("stsd", u32be(0), u32be(1), atom(codec, sampleEntry, atom("zzzz")));
  return atom("trak", atom("mdia", mdhd, hdlr, atom("minf", atom("stbl", stsd))));
};

const makeM4a = (index: number, malformed: boolean) => {
  const metadata = canonicalFor(index);
  const variant = mp4Variants[index % mp4Variants.length]!;
  const codec = variant.startsWith("alac") ? "alac" : "mp4a";
  const metadataTree = atom(
    "udta",
    atom("meta", u32be(0), atom("hdlr", new Uint8Array(24)), ilst(metadata, index)),
  );
  const moov = atom(
    "moov",
    audioTrack(codec),
    metadataTree,
    variant === "unknown-atom" ? atom("Xtra", ascii(`opaque-atom-${index}`)) : new Uint8Array(),
  );
  const ftyp = atom("ftyp", ascii("M4A "), u32be(0), ascii("M4A "), ascii("isom"));
  const payload = mp4Audio(index);
  let bytes =
    variant === "multiple-mdat"
      ? concat(
          ftyp,
          atom("mdat", payload.slice(0, 99)),
          moov,
          atom("free", new Uint8Array(31)),
          atom("mdat", payload.slice(99)),
        )
      : concat(ftyp, moov, atom("mdat", payload));
  if (malformed) {
    const mode = index % 3;
    if (mode === 0) bytes = bytes.slice(0, 11);
    else if (mode === 1) bytes = concat(ascii("OggSrenamed.m4a"), bytes.slice(0, 24));
    else bytes = concat(u32be(0x7fff_ffff), ascii("ftyp"), bytes.slice(8, 20));
  }
  return { bytes, variant, metadata };
};

export const materializeFixture = (family: FixtureFamily, index: number) => {
  const malformed = index % 10 === 9;
  if (family === "mp3") return { ...makeMp3(index, malformed), malformed };
  if (family === "flac") return { ...makeFlac(index, malformed), malformed };
  return { ...makeM4a(index, malformed), malformed };
};

export const generateCorpus = (seed = DEFAULT_CORPUS_SEED): FixtureCase[] => {
  const cases: FixtureCase[] = [];
  for (const family of ["mp3", "flac", "m4a"] as const) {
    for (let index = 0; index < FAMILY_CASES; index++) {
      const fixture = materializeFixture(family, index);
      let payloadHash: string | null = null;
      if (!fixture.malformed) payloadHash = audioPayloadSha256(family, fixture.bytes);
      const features = [
        fixture.variant,
        strings[index % strings.length]!.startsWith("long-") ? "long-text" : "unicode",
      ];
      if (family === "mp3" && index % 20 === 2) features.push("extended-header");
      if (family === "mp3" && index % 40 === 23) features.push("footer");
      if (family === "mp3" && (index % 40 === 7 || index % 40 === 23)) {
        features.push("unsynchronisation");
      }
      if (index % 4 === 0) features.push("duplicates");
      if (fixture.metadata.artworkCount > 1) features.push("multiple-artwork");
      if (index === 176) features.push("large-artwork");
      if (fixture.malformed)
        features.push(index % 3 === 1 ? "mislabeled" : "malformed-or-truncated");
      cases.push({
        id: `${family}-${String(index).padStart(3, "0")}`,
        family,
        variant: fixture.variant,
        seed: (seed + index * 0x9e37 + family.charCodeAt(0)) >>> 0,
        expected: fixture.malformed ? "rejected" : "accepted",
        features,
        canonical: fixture.malformed ? null : fixture.metadata,
        fixtureSha256: sha256(fixture.bytes),
        audioPayloadSha256: payloadHash,
        byteLength: fixture.bytes.length,
      });
    }
  }
  return cases;
};

export const stableManifestJson = (cases: readonly FixtureCase[]) =>
  `${JSON.stringify(cases, null, 2)}\n`;
