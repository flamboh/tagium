import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { parseBuffer } from "music-metadata";
import { TagLib, type Picture, type PropertyMap } from "taglib-wasm";

const OUTPUT_DIR = process.env.TAGIUM_FLAC_BAKEOFF_DIR ?? "/tmp/tagium-flac-bakeoff-evidence";

type FlacBlock = {
  type: number;
  data: Uint8Array;
};

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

const readUint24 = (bytes: Uint8Array, offset: number) =>
  (bytes[offset]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset + 2]!;

const parseFlac = (bytes: Uint8Array) => {
  assert(bytes.length >= 8, "FLAC input is truncated");
  assert(new TextDecoder().decode(bytes.subarray(0, 4)) === "fLaC", "FLAC marker is missing");

  const blocks: FlacBlock[] = [];
  let offset = 4;
  let isLast = false;
  while (!isLast) {
    assert(offset + 4 <= bytes.length, "FLAC metadata header is truncated");
    isLast = (bytes[offset]! & 0x80) !== 0;
    const type = bytes[offset]! & 0x7f;
    const size = readUint24(bytes, offset + 1);
    assert(offset + 4 + size <= bytes.length, "FLAC metadata block is truncated");
    blocks.push({ type, data: bytes.slice(offset + 4, offset + 4 + size) });
    offset += 4 + size;
  }
  assert(blocks[0]?.type === 0 && blocks[0].data.length === 34, "FLAC STREAMINFO is invalid");
  return { blocks, audioOffset: offset };
};

const encodeBlocks = (blocks: FlacBlock[], audio: Uint8Array) => {
  const total = 4 + blocks.reduce((size, block) => size + 4 + block.data.length, 0) + audio.length;
  const result = new Uint8Array(total);
  result.set(new TextEncoder().encode("fLaC"));
  let offset = 4;
  blocks.forEach((block, index) => {
    assert(block.data.length <= 0xffffff, "metadata block exceeds FLAC's 24-bit limit");
    result[offset] = block.type | (index === blocks.length - 1 ? 0x80 : 0);
    result[offset + 1] = (block.data.length >>> 16) & 0xff;
    result[offset + 2] = (block.data.length >>> 8) & 0xff;
    result[offset + 3] = block.data.length & 0xff;
    result.set(block.data, offset + 4);
    offset += 4 + block.data.length;
  });
  result.set(audio, offset);
  return result;
};

const injectApplicationBlock = (bytes: Uint8Array) => {
  const { blocks, audioOffset } = parseFlac(bytes);
  const sentinel = new TextEncoder().encode("TGM0unknown-block-preservation-sentinel");
  return {
    bytes: encodeBlocks([...blocks, { type: 2, data: sentinel }], bytes.subarray(audioOffset)),
    sentinelHash: sha256(sentinel),
  };
};

const audioPayloadHash = (bytes: Uint8Array) => {
  const { audioOffset } = parseFlac(bytes);
  return sha256(bytes.subarray(audioOffset));
};

const applicationBlockHashes = (bytes: Uint8Array) =>
  parseFlac(bytes)
    .blocks.filter(({ type }) => type === 2)
    .map(({ data }) => sha256(data));

const runFfmpeg = (args: string[]) => {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || "ffmpeg fixture generation failed");
};

const generateFixtures = async () => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const fixtures = [
    { name: "small.flac", seconds: 300, rate: 44_100, frequency: 440 },
    { name: "sixty-minute.flac", seconds: 3_600, rate: 44_100, frequency: 330 },
    { name: "large.flac", seconds: 21_600, rate: 48_000, frequency: 220 },
  ] as const;

  for (const fixture of fixtures) {
    const path = `${OUTPUT_DIR}/${fixture.name}`;
    runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${fixture.frequency}:sample_rate=${fixture.rate}:duration=${fixture.seconds}`,
      "-ac",
      "2",
      "-c:a",
      "flac",
      "-compression_level",
      "5",
      "-metadata",
      "title=Original שלום 🎵",
      "-metadata",
      "artist=Artist One",
      "-metadata",
      "album=Bakeoff Album",
      "-metadata",
      "genre=Ambient",
      "-metadata",
      "date=2024-03-02",
      "-metadata",
      "track=2/9",
      "-metadata",
      "album_artist=Album Artist",
      "-metadata",
      "composer=Composer Ω",
      "-metadata",
      "bpm=123",
      "-metadata",
      "comment=Original comment",
      "-metadata",
      "X_TAGIUM_SENTINEL=preserve-me",
      "-y",
      path,
    ]);
  }

  const smallPath = `${OUTPUT_DIR}/small.flac`;
  const injected = injectApplicationBlock(new Uint8Array(await readFile(smallPath)));
  await writeFile(smallPath, injected.bytes);
  return { fixtures, sentinelHash: injected.sentinelHash };
};

const onePixelPng = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

const alternatePng = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mP8z8AARAwMjDAGAC4HAQnWJQQAAAAASUVORK5CYII=",
    "base64",
  ),
);

const cover = (data: Uint8Array, description: string): Picture => ({
  type: "FrontCover",
  mimeType: "image/png",
  description,
  data,
});

const bytesEqual = (actual: Uint8Array, expected: Uint8Array) =>
  actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);

const assertArtworkReadback = async (
  label: string,
  bytes: Uint8Array,
  expectedData: Uint8Array,
  expectedDescription: string,
) => {
  const reread = await parseBuffer(bytes, { mimeType: "audio/flac", size: bytes.length });
  const pictures = reread.common.picture ?? [];
  assert(pictures.length === 1, `${label}: expected exactly one picture`);
  const picture = pictures[0]!;
  assert(bytesEqual(picture.data, expectedData), `${label}: picture bytes changed`);
  assert(picture.format === "image/png", `${label}: picture MIME mismatch`);
  assert(picture.type === "Cover (front)", `${label}: picture type mismatch`);
  assert(picture.description === expectedDescription, `${label}: picture description mismatch`);
};

const openAndSave = async (
  taglib: Awaited<ReturnType<typeof TagLib.initialize>>,
  input: Uint8Array,
  edit: (file: Awaited<ReturnType<typeof taglib.open>>) => void,
) => {
  const file = await taglib.open(input);
  try {
    assert(file.isValid(), "taglib-wasm rejected a generated FLAC fixture");
    edit(file);
    assert(file.save(), "taglib-wasm failed to save FLAC metadata");
    return file.getFileBuffer().slice();
  } finally {
    file.dispose();
  }
};

const measureWrite = async (
  taglib: Awaited<ReturnType<typeof TagLib.initialize>>,
  path: string,
) => {
  const input = new Uint8Array(await readFile(path));
  const before = process.memoryUsage().rss;
  const started = performance.now();
  const output = await openAndSave(taglib, input, (file) => {
    file.setProperty("TITLE", "Measured write");
  });
  const elapsedMs = performance.now() - started;
  const after = process.memoryUsage().rss;
  assert(audioPayloadHash(input) === audioPayloadHash(output), `${path}: audio payload changed`);
  return {
    inputBytes: input.byteLength,
    outputBytes: output.byteLength,
    writeMs: Math.round(elapsedMs),
    observedRssDeltaBytes: Math.max(0, after - before),
  };
};

const measureInIsolatedProcess = (path: string) => {
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), "--measure-one", path],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  if (child.status !== 0) {
    throw new Error(child.stderr || `isolated measurement failed for ${path}`);
  }
  return JSON.parse(child.stdout) as {
    inputBytes: number;
    outputBytes: number;
    writeMs: number;
    baselineRssBytes: number;
    peakRssBytes: number;
    peakRssIncreaseBytes: number;
  };
};

const measureOne = async (path: string) => {
  const taglib = await TagLib.initialize();
  const baselineRssBytes = process.resourceUsage().maxRSS;
  const measurement = await measureWrite(taglib, path);
  const peakRssBytes = process.resourceUsage().maxRSS;
  console.log(
    JSON.stringify({
      ...measurement,
      baselineRssBytes,
      peakRssBytes,
      peakRssIncreaseBytes: Math.max(0, peakRssBytes - baselineRssBytes),
    }),
  );
};

const isRejected = async (
  taglib: Awaited<ReturnType<typeof TagLib.initialize>>,
  input: Uint8Array,
) => {
  let rejected = false;
  try {
    const file = await taglib.open(input);
    try {
      rejected = !file.isValid();
    } finally {
      file.dispose();
    }
  } catch {
    rejected = true;
  }
  return rejected;
};

const main = async () => {
  const { fixtures, sentinelHash } = await generateFixtures();
  const taglib = await TagLib.initialize();
  const source = new Uint8Array(await readFile(`${OUTPUT_DIR}/small.flac`));
  const originalPayloadHash = audioPayloadHash(source);

  const withTags = await openAndSave(taglib, source, (file) => {
    const properties: PropertyMap = {
      ...file.properties(),
      TITLE: ["Edited café 東京 🎧"],
      ARTIST: ["Artist One", "Artist Two"],
      ALBUM: ["Edited Album"],
      ALBUMARTIST: ["Album Artist"],
      COMPOSER: ["Composer Ω"],
      DISCNUMBER: ["2"],
      BPM: ["127"],
      COMMENT: ["Edited comment שלום"],
    };
    file.setProperties(properties);
  });
  assert(audioPayloadHash(withTags) === originalPayloadHash, "common/advanced edit changed audio");
  assert(
    applicationBlockHashes(withTags).includes(sentinelHash),
    "unknown FLAC APPLICATION block was not preserved",
  );

  const withCover = await openAndSave(taglib, withTags, (file) =>
    file.setPictures([cover(onePixelPng, "first")]),
  );
  const replacedCover = await openAndSave(taglib, withCover, (file) =>
    file.setPictures([cover(alternatePng, "replacement")]),
  );
  const withoutCover = await openAndSave(taglib, replacedCover, (file) => file.removePictures());
  for (const [label, bytes] of [
    ["cover add", withCover],
    ["cover replace", replacedCover],
    ["cover remove", withoutCover],
  ] as const) {
    assert(audioPayloadHash(bytes) === originalPayloadHash, `${label} changed audio`);
    assert(applicationBlockHashes(bytes).includes(sentinelHash), `${label} lost unknown block`);
  }

  const independent = await parseBuffer(withTags, {
    mimeType: "audio/flac",
    size: withTags.length,
  });
  assert(independent.common.title === "Edited café 東京 🎧", "independent parser title mismatch");
  assert(independent.common.album === "Edited Album", "independent parser album mismatch");
  assert(
    independent.common.albumartist === "Album Artist",
    "independent parser album artist mismatch",
  );
  assert(
    independent.common.composer?.includes("Composer Ω"),
    "independent parser composer mismatch",
  );
  assert(independent.common.disk.no === 2, "independent parser disc number mismatch");
  assert(independent.common.bpm === 127, "independent parser BPM mismatch");
  assert(independent.common.artists?.length === 2, "repeated artist values did not round-trip");
  assert(independent.common.artists.includes("Artist One"), "first artist value mismatch");
  assert(independent.common.artists.includes("Artist Two"), "second artist value mismatch");
  assert(independent.common.year === 2024, "independent parser year mismatch");
  assert(independent.common.date === "2024-03-02", "independent parser full date mismatch");
  assert(independent.common.genre?.includes("Ambient"), "independent parser genre mismatch");
  assert(independent.common.track.no === 2, "independent parser track number mismatch");
  assert(
    independent.common.comment?.some(({ text }) => text === "Edited comment שלום"),
    "independent parser edited Hebrew comment mismatch",
  );
  const nativeValues = independent.native.vorbis?.flatMap(({ id, value }) =>
    id.toUpperCase() === "X_TAGIUM_SENTINEL" ? [String(value)] : [],
  );
  assert(nativeValues?.includes("preserve-me"), "unknown Vorbis comment was not preserved");

  await assertArtworkReadback("cover add", withCover, onePixelPng, "first");
  await assertArtworkReadback("cover replacement", replacedCover, alternatePng, "replacement");
  const noCoverRead = await parseBuffer(withoutCover, {
    mimeType: "audio/flac",
    size: withoutCover.length,
  });
  assert(!noCoverRead.common.picture?.length, "cover removal mismatch");

  const malformedCorpus: Record<string, boolean> = {};
  malformedCorpus.truncated = await isRejected(taglib, source.subarray(0, 31));
  const malformed = source.slice();
  malformed[0] = 0;
  malformedCorpus.missingMarker = await isRejected(taglib, malformed);

  const invalidBlockLength = source.slice();
  invalidBlockLength[5] = 0xff;
  invalidBlockLength[6] = 0xff;
  invalidBlockLength[7] = 0xff;
  malformedCorpus.invalidBlockLength = await isRejected(taglib, invalidBlockLength);

  const invalidBlockType = source.slice();
  invalidBlockType[4] = (invalidBlockType[4]! & 0x80) | 0x7f;
  malformedCorpus.reservedBlockType = await isRejected(taglib, invalidBlockType);

  const parsedSource = parseFlac(source);
  const duplicateStreamInfo = encodeBlocks(
    [parsedSource.blocks[0]!, ...parsedSource.blocks],
    source.subarray(parsedSource.audioOffset),
  );
  malformedCorpus.duplicateStreamInfo = await isRejected(taglib, duplicateStreamInfo);

  const malformedVorbisBlocks = parsedSource.blocks.map((block) => {
    if (block.type !== 4) return block;
    const data = block.data.slice();
    const vendorLength = data[0]! | (data[1]! << 8) | (data[2]! << 16) | (data[3]! << 24);
    const countOffset = 4 + vendorLength;
    data.fill(0xff, countOffset, countOffset + 4);
    return { type: block.type, data };
  });
  malformedCorpus.invalidVorbisCommentCount = await isRejected(
    taglib,
    encodeBlocks(malformedVorbisBlocks, source.subarray(parsedSource.audioOffset)),
  );

  const malformedPicture = new Uint8Array(12);
  malformedPicture.set([0, 0, 0, 3, 0xff, 0xff, 0xff, 0xff]);
  malformedCorpus.truncatedPicture = await isRejected(
    taglib,
    encodeBlocks(
      [...parsedSource.blocks, { type: 6, data: malformedPicture }],
      source.subarray(parsedSource.audioOffset),
    ),
  );

  const measurements: Record<string, ReturnType<typeof measureInIsolatedProcess>> = {};
  for (const fixture of fixtures) {
    measurements[fixture.name] = measureInIsolatedProcess(`${OUTPUT_DIR}/${fixture.name}`);
  }

  const browserEntry = new Uint8Array(
    await readFile("node_modules/taglib-wasm/dist/index.browser.js"),
  );
  const browserWasm = new Uint8Array(
    await readFile("node_modules/taglib-wasm/dist/taglib-web.wasm"),
  );
  const browserWrapper = new Uint8Array(
    await readFile("node_modules/taglib-wasm/dist/taglib-wrapper.js"),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    runtime: `Bun ${process.versions.bun ?? "unknown"} on ${process.platform}/${process.arch}`,
    candidate: "taglib-wasm@1.5.2",
    independentParser: "music-metadata@11.8.3",
    gates: {
      commonAndAdvancedFields: "pass",
      unicodeAndRepeatedValues: "pass",
      coverAddReplaceRemove: "pass",
      coverArtworkExactBytesAndAttributes: "pass",
      unknownVorbisComment: "pass",
      unknownApplicationBlock: "pass",
      encodedAudioPayloadHash: originalPayloadHash,
      malformedCorpusRejected: malformedCorpus,
    },
    browserPayload: {
      entryRawBytes: browserEntry.length,
      entryGzipBytes: gzipSync(browserEntry, { level: 9 }).length,
      wasmRawBytes: browserWasm.length,
      wasmGzipBytes: gzipSync(browserWasm, { level: 9 }).length,
      wrapperRawBytes: browserWrapper.length,
      wrapperGzipBytes: gzipSync(browserWrapper, { level: 9 }).length,
    },
    measurements,
  };
  await writeFile(`${OUTPUT_DIR}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
};

const verifyArtworkOnly = async (path: string) => {
  const taglib = await TagLib.initialize();
  const source = new Uint8Array(await readFile(path));
  const originalPayloadHash = audioPayloadHash(source);
  const baseline = await openAndSave(taglib, source, (file) => file.removePictures());
  const withCover = await openAndSave(taglib, baseline, (file) =>
    file.setPictures([cover(onePixelPng, "first")]),
  );
  const replacedCover = await openAndSave(taglib, withCover, (file) =>
    file.setPictures([cover(alternatePng, "replacement")]),
  );
  const withoutCover = await openAndSave(taglib, replacedCover, (file) => file.removePictures());

  await assertArtworkReadback("cover add", withCover, onePixelPng, "first");
  await assertArtworkReadback("cover replacement", replacedCover, alternatePng, "replacement");
  const removedRead = await parseBuffer(withoutCover, {
    mimeType: "audio/flac",
    size: withoutCover.length,
  });
  assert(!removedRead.common.picture?.length, "cover removal mismatch");
  for (const [label, bytes] of [
    ["cover add", withCover],
    ["cover replace", replacedCover],
    ["cover remove", withoutCover],
  ] as const) {
    assert(audioPayloadHash(bytes) === originalPayloadHash, `${label} changed audio`);
  }
  console.log(
    JSON.stringify({
      fixture: path,
      coverAddExactBytes: "pass",
      coverReplaceExactBytes: "pass",
      coverMimePictureTypeDescription: "pass",
      coverRemove: "pass",
      encodedAudioPayloadHash: originalPayloadHash,
    }),
  );
};

if (process.argv[2] === "--measure-one") {
  const path = process.argv[3];
  assert(path, "measurement path is required");
  await measureOne(path);
} else if (process.argv[2] === "--artwork-only") {
  const path = process.argv[3] ?? `${OUTPUT_DIR}/small.flac`;
  await verifyArtworkOnly(path);
} else {
  await main();
}
