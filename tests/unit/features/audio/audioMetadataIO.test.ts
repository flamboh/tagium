import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { AudioMetadataIO, AudioMetadataIOLive } from "@/features/audio/audioMetadataIO";
import { makeAudioRuntime } from "@/features/audio/audioRuntime";
import type { AudioMetadata, TagiumFile } from "@/features/library/types";
import { validMp3Bytes } from "../../support/mp3TestFixtures";

const runtime = makeAudioRuntime(AudioMetadataIOLive);
const run = <A, E>(effect: Effect.Effect<A, E, AudioMetadataIO>) => runtime.runPromise(effect);
const parse = (files: File[]) =>
  run(
    Effect.gen(function* () {
      return yield* (yield* AudioMetadataIO).parseUploadedTracks(files);
    }),
  );
const write = (file: TagiumFile, metadata: AudioMetadata) =>
  run(
    Effect.gen(function* () {
      return yield* (yield* AudioMetadataIO).writeMetadataToFile(file, metadata);
    }),
  );

const metadata = (overrides: Partial<AudioMetadata> = {}): AudioMetadata => ({
  filename: "track",
  title: "",
  artist: "",
  album: "",
  year: null,
  genre: "",
  duration: 0,
  bitrate: 128_000,
  sampleRate: 44_100,
  picture: [],
  trackNumber: null,
  ...overrides,
});

describe("AudioMetadataIO", () => {
  it("detects MP3 from bytes without trusting its name or MIME", async () => {
    const [upload] = await parse([
      new File([validMp3Bytes()], "renamed.bin", { type: "text/plain" }),
    ]);
    expect(upload.file.status).toBe("pending");
    expect(upload.file.format).toMatchObject({ kind: "mp3", extension: "mp3" });
    expect(upload.file.metadata).toMatchObject({
      filename: "renamed.bin",
      bitrate: 128_000,
      sampleRate: 44_100,
    });
  });

  it("returns actionable errors for empty, corrupt, and truncated format signatures", async () => {
    const uploads = await parse([
      new File([], "empty.mp3"),
      new File(["not audio"], "corrupt.mp3"),
      new File(["fLaC0000"], "truncated.flac"),
    ]);
    expect(uploads.map((upload) => upload.file.status)).toEqual(["error", "error", "error"]);
    expect(uploads.map((upload) => upload.file.downloadError)).toEqual([
      "audio file is empty.",
      "unsupported or corrupt audio file. Tagium supports MP3, FLAC, and unencrypted M4A/MP4 audio.",
      "FLAC file is truncated.",
    ]);
  });

  it("writes ID3 metadata while preserving every original MPEG payload byte", async () => {
    const source = new File([validMp3Bytes()], "source.mp3", { type: "audio/mpeg" });
    const [parsed] = await parse([source]);
    const next = metadata({
      ...parsed.file.metadata,
      filename: "written",
      title: "Track 😀",
      artist: "Artist",
      year: 2024,
      trackNumber: 3,
      picture: [
        {
          format: "image/jpeg",
          type: 3,
          description: "cover",
          data: new Uint8Array([4, 5, 6]),
        },
      ],
    });
    const output = await write(parsed.file, next);
    const outputBytes = new Uint8Array(await output.arrayBuffer());
    const id3Size =
      10 +
      ((outputBytes[6]! << 21) |
        (outputBytes[7]! << 14) |
        (outputBytes[8]! << 7) |
        outputBytes[9]!);
    expect(output.name).toBe("written.mp3");
    expect(outputBytes.subarray(id3Size)).toEqual(validMp3Bytes());
    const [roundTrip] = await parse([output]);
    expect(roundTrip.file.metadata).toMatchObject({
      title: "Track 😀",
      artist: "Artist",
      year: 2024,
      trackNumber: 3,
    });
    expect(roundTrip.file.metadata?.picture).toHaveLength(1);
  });

  it("keeps no-op export bytes identical and rejects writes before download", async () => {
    const source = new File([validMp3Bytes()], "track.mp3", { type: "audio/mpeg" });
    const [parsed] = await parse([source]);
    const output = await write(parsed.file, parsed.file.metadata!);
    expect(new Uint8Array(await output.arrayBuffer())).toEqual(validMp3Bytes());
    await expect(write({ ...parsed.file, file: undefined }, parsed.file.metadata!)).rejects.toThrow(
      "audio file is still downloading.",
    );
  });

  it("rejects numeric metadata that cannot round-trip through every driver", async () => {
    const source = new File([validMp3Bytes()], "track.mp3", { type: "audio/mpeg" });
    const [parsed] = await parse([source]);
    await expect(
      write(parsed.file, { ...parsed.file.metadata!, trackNumber: 65_536 }),
    ).rejects.toThrow("track number must be a whole number from 1 to 65535.");
    await expect(
      write(parsed.file, { ...parsed.file.metadata!, year: Number.POSITIVE_INFINITY }),
    ).rejects.toThrow("year must be a whole number from 0 to 9999.");
  });
});
