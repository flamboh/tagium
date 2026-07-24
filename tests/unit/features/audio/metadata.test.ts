import { Effect, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { audioMetadataPatchSchema, audioMetadataSchema } from "@/features/audio/metadata";
import { patchAudioFileWithChanges } from "@/features/audio/metadataEngine/engine";
import { validMp3Bytes } from "../../support/mp3TestFixtures";

const metadata = {
  filename: "track",
  title: "Track",
  artist: "Artist",
  albumArtist: "",
  album: "Album",
  year: null,
  genre: "",
  duration: 1,
  bitrate: 128_000,
  sampleRate: 44_100,
  picture: [],
  trackNumber: null,
  composer: "",
  comment: "",
  discNumber: null,
  bpm: null,
};

describe("canonical audio metadata schemas", () => {
  it("requires every canonical advanced field", () => {
    expect(() =>
      Schema.decodeUnknownSync(audioMetadataSchema)({
        ...metadata,
        albumArtist: undefined,
      }),
    ).toThrow();
  });

  it.each([
    ["discNumber", 0],
    ["discNumber", 1.5],
    ["discNumber", 1_000],
    ["bpm", 0],
    ["bpm", 1.5],
    ["bpm", 1_000],
  ] as const)("rejects invalid %s=%s in snapshots and patches", (field, value) => {
    expect(() =>
      Schema.decodeUnknownSync(audioMetadataSchema)({ ...metadata, [field]: value }),
    ).toThrow();
    expect(() => Schema.decodeUnknownSync(audioMetadataPatchSchema)({ [field]: value })).toThrow();
  });

  it("accepts sparse unchanged fields and explicit numeric clears", () => {
    expect(Schema.decodeUnknownSync(audioMetadataPatchSchema)({ composer: "" })).toEqual({
      composer: "",
    });
    expect(
      Schema.decodeUnknownSync(audioMetadataPatchSchema)({ discNumber: null, bpm: null }),
    ).toEqual({ discNumber: null, bpm: null });
  });

  it.each([{ discNumber: 0 }, { discNumber: 1.5 }, { bpm: 0 }, { bpm: 1.5 }])(
    "keeps invalid advanced numbers behind the engine backstop",
    async (changes) => {
      await expect(
        Effect.runPromise(
          patchAudioFileWithChanges(new File([validMp3Bytes()], "track.mp3"), changes, "track"),
        ),
      ).rejects.toMatchObject({ _tag: "AudioMetadataWriteError" });
    },
  );
});
