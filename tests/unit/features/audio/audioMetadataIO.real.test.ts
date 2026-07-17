import { Effect } from "effect";
import MP3Tag from "mp3tag.js";
import { describe, expect, it } from "vite-plus/test";
import { AudioMetadataIO, AudioMetadataIOLive } from "@/features/audio/audioMetadataIO";
import { makeAudioRuntime } from "@/features/audio/audioRuntime";
import type { AudioMetadata, TagiumFile } from "@/features/library/types";
import { validMp3Bytes } from "../../support/mp3TestFixtures";

const runtime = makeAudioRuntime(AudioMetadataIOLive);

const metadata = (overrides: Partial<AudioMetadata> = {}): AudioMetadata => ({
  filename: "track",
  title: "Track",
  artist: "Artist",
  albumArtist: "Album Artist",
  album: "Album",
  year: 2026,
  genre: "Electronic",
  duration: 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  trackNumber: 1,
  discNumber: 2,
  composer: "Composer",
  bpm: 128,
  comment: "Primary comment",
  ...overrides,
});

const write = (source: Uint8Array, nextMetadata = metadata()) => {
  const sourceFile = new File([Uint8Array.from(source)], "track.mp3", { type: "audio/mpeg" });
  const file: TagiumFile = {
    id: "track",
    format: "mp3",
    file: sourceFile,
    originalFile: sourceFile,
    filename: sourceFile.name,
    status: "pending",
    downloadStatus: "ready",
    metadata: nextMetadata,
  };

  return runtime.runPromise(
    Effect.gen(function* () {
      const io = yield* AudioMetadataIO;
      return yield* io.writeMetadataToFile(file, nextMetadata);
    }),
  );
};

const bytesOf = (buffer: unknown) =>
  buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : Uint8Array.from(buffer as ArrayLike<number>);

describe("AudioMetadataIO with real mp3tag.js", () => {
  it("creates ID3v2 metadata when writing an untagged MP3", async () => {
    const updated = await write(validMp3Bytes());
    const tags = new MP3Tag(await updated.arrayBuffer());
    tags.read({ unsupported: true });

    expect(tags.error).toBe("");
    expect(tags.tags.v2Details?.version[0]).toBe(4);
    expect(tags.tags.v2).toMatchObject({
      TPE2: "Album Artist",
      TCOM: "Composer",
      TBPM: "128",
      TPOS: "2",
      COMM: [{ language: "eng", descriptor: "", text: "Primary comment" }],
    });
  });

  it("preserves unsupported frames, alternate comments, and audio payload", async () => {
    const sourceAudio = validMp3Bytes();
    const seeded = new MP3Tag(sourceAudio.buffer.slice(0));
    seeded.read({ unsupported: true });
    seeded.tags.v2 = {
      TIT2: "Original",
      COMM: [
        { language: "eng", descriptor: "", text: "Original primary" },
        { language: "spa", descriptor: "archivo", text: "Conservar" },
      ],
    };
    seeded.tags.v2Details = {
      version: [4, 0],
      size: 0,
      flags: {
        unsynchronisation: false,
        extendedHeader: false,
        experimentalIndicator: false,
      },
    };
    (seeded.tags.v2 as Record<string, unknown>).ZZZZ = [[1, 2, 3, 4]];
    seeded.save({ id3v2: { unsupported: true, padding: 0 } });
    expect(seeded.error).toBe("");

    const updated = await write(bytesOf(seeded.buffer), metadata({ comment: "Updated primary" }));
    const outputBuffer = await updated.arrayBuffer();
    const reread = new MP3Tag(outputBuffer);
    reread.read({ unsupported: true });

    expect(reread.error).toBe("");
    expect((reread.tags.v2 as Record<string, unknown>).ZZZZ).toEqual([[1, 2, 3, 4]]);
    expect(reread.tags.v2?.COMM).toEqual([
      { language: "eng", descriptor: "", text: "Updated primary" },
      { language: "spa", descriptor: "archivo", text: "Conservar" },
    ]);
    expect(bytesOf(MP3Tag.getAudioBuffer(outputBuffer))).toEqual(sourceAudio);
  });
});
