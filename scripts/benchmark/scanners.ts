import { Effect } from "effect";
import type { AllocationMetrics } from "./types";

// Computed runtime imports keep the Node-only benchmark tsconfig from pulling
// DOM-targeted production modules into its compilation unit. The modules are
// still the production detector and driver used by the running application.
const detectModulePath = "../../src/features/audio/metadataEngine/detect.ts";
const mp3ModulePath = "../../src/features/audio/metadataEngine/mp3/mp3Driver.ts";
const productionModules = Promise.all([import(detectModulePath), import(mp3ModulePath)]);

export const emptyMetrics = (): AllocationMetrics => ({
  bytesRead: 0,
  copiedBytes: 0,
  largestRead: 0,
  peakAllocatedBytes: 0,
  maxConcurrency: 0,
});

interface Tracker extends AllocationMetrics {
  activeScans: number;
  retainedBytes: number;
}

const makeTracker = (): Tracker => ({ ...emptyMetrics(), activeScans: 0, retainedBytes: 0 });

const beginScan = (tracker: Tracker) => {
  tracker.activeScans++;
  tracker.maxConcurrency = Math.max(tracker.maxConcurrency, tracker.activeScans);
};

const endScan = (tracker: Tracker, retainedBytes: number) => {
  tracker.activeScans--;
  tracker.retainedBytes -= retainedBytes;
};

const finishMetrics = (tracker: Tracker): AllocationMetrics => ({
  bytesRead: tracker.bytesRead,
  copiedBytes: tracker.copiedBytes,
  largestRead: tracker.largestRead,
  peakAllocatedBytes: tracker.peakAllocatedBytes,
  maxConcurrency: tracker.maxConcurrency,
});

// Copied from the admission semantics in HEAD:src/features/audio/mp3Compatibility.ts.
// The historical production path first materialized the entire File, then checked
// the first two fixed-length MPEG frames before constructing MP3Tag over that buffer.
const assertLegacyMp3Admission = (bytes: Uint8Array) => {
  let audioStart = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    audioStart = 10 + ((bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!);
  }
  const first = bytes.subarray(audioStart, audioStart + 4);
  if (first[0] !== 0xff || (first[1]! & 0xe0) !== 0xe0) {
    throw new Error("legacy admission rejected deterministic MP3 fixture");
  }
};

// Minimal copy of the relevant old mp3tag.js read work. It validates and walks
// ID3v2 frames from the already-materialized whole-file buffer. The benchmark
// intentionally does not keep mp3tag.js as a production dependency solely to
// measure a removed path.
const readLegacyId3 = (bytes: Uint8Array) => {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return;
  const version = bytes[3];
  const tagEnd = 10 + ((bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!);
  const headerSize = version === 2 ? 6 : 10;
  let offset = 10;
  while (offset + headerSize <= tagEnd) {
    const size =
      version === 2
        ? bytes[offset + 3]! * 0x10000 + bytes[offset + 4]! * 0x100 + bytes[offset + 5]!
        : version === 4
          ? (bytes[offset + 4]! << 21) |
            (bytes[offset + 5]! << 14) |
            (bytes[offset + 6]! << 7) |
            bytes[offset + 7]!
          : bytes[offset + 4]! * 0x1000000 +
            bytes[offset + 5]! * 0x10000 +
            bytes[offset + 6]! * 0x100 +
            bytes[offset + 7]!;
    if (size === 0) break;
    if (size < 0 || offset + headerSize + size > tagEnd)
      throw new Error("legacy ID3 parser rejected fixture");
    offset += headerSize + size;
  }
};

// The removed path also waited for HTMLAudioElement to parse the MPEG stream
// before an import completed. Bun has no HTMLAudioElement, so reproduce that
// frame-header duration work deterministically instead of omitting it from the
// fixed-revision baseline.
const readLegacyDuration = (bytes: Uint8Array) => {
  let offset =
    bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33
      ? 10 + ((bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!)
      : 0;
  let frames = 0;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1]! & 0xe0) !== 0xe0) break;
    const padding = (bytes[offset + 2]! >> 1) & 1;
    offset += Math.floor((144 * 128_000) / 44_100 + padding);
    frames++;
  }
  if (frames < 2) throw new Error("legacy duration parser rejected deterministic MP3 fixture");
  return (frames * 1152) / 44_100;
};

export const scanLegacySerial = async (files: File[]) => {
  const tracker = makeTracker();
  for (const file of files) {
    beginScan(tracker);
    const buffer = await file.arrayBuffer();
    tracker.bytesRead += buffer.byteLength;
    tracker.copiedBytes += buffer.byteLength;
    tracker.largestRead = Math.max(tracker.largestRead, buffer.byteLength);
    tracker.retainedBytes += buffer.byteLength;
    tracker.peakAllocatedBytes = Math.max(tracker.peakAllocatedBytes, tracker.retainedBytes);
    const bytes = new Uint8Array(buffer);
    assertLegacyMp3Admission(bytes);
    readLegacyId3(bytes);
    readLegacyDuration(bytes);
    endScan(tracker, buffer.byteLength);
  }
  return finishMetrics(tracker);
};

const makeInstrumentedSource = (file: File, tracker: Tracker) => {
  let retainedBytes = 0;
  let cached: { offset: number; bytes: Uint8Array<ArrayBuffer> } | undefined;
  const source = {
    size: file.size,
    slice: (start?: number, end?: number) => file.slice(start, end),
    read: (offset: number, length: number) =>
      Effect.tryPromise({
        try: async () => {
          if (length > 8 * 1024 * 1024) throw new Error(`range read ${length} exceeds 8 MiB`);
          if (
            cached &&
            offset >= cached.offset &&
            offset + length <= cached.offset + cached.bytes.length
          ) {
            const start = offset - cached.offset;
            return cached.bytes.subarray(start, start + length);
          }
          const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
          tracker.bytesRead += bytes.byteLength;
          tracker.copiedBytes += bytes.byteLength;
          tracker.largestRead = Math.max(tracker.largestRead, bytes.byteLength);
          retainedBytes += bytes.byteLength;
          tracker.retainedBytes += bytes.byteLength;
          tracker.peakAllocatedBytes = Math.max(tracker.peakAllocatedBytes, tracker.retainedBytes);
          cached = { offset, bytes };
          return bytes;
        },
        catch: (cause) => new Error("benchmark range read failed", { cause }),
      }),
  };
  return { source, release: () => endScan(tracker, retainedBytes) };
};

export const scanCandidateConcurrent = async (files: File[], concurrency: number) => {
  const tracker = makeTracker();
  const scan = Effect.forEach(
    files,
    (file) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          beginScan(tracker);
          return makeInstrumentedSource(file, tracker);
        }),
        ({ source }) =>
          Effect.gen(function* () {
            const [{ detectAudioFormat }, { mp3Driver }] = yield* Effect.promise(
              () => productionModules,
            );
            const kind = yield* detectAudioFormat(source);
            if (kind !== "mp3") {
              return yield* Effect.die(new Error("candidate detector returned a non-MP3 format"));
            }
            yield* mp3Driver.inspect(source);
          }),
        ({ release }) => Effect.sync(release),
      ),
    { concurrency, discard: true },
  );
  await Effect.runPromise(scan as Effect.Effect<void, unknown, never>);
  return finishMetrics(tracker);
};
