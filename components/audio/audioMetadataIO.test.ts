import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AudioMetadataIO, AudioMetadataIOLive } from "./audioMetadataIO";
import { makeAudioRuntime } from "./audioRuntime";
import type { AudioMetadata, TagiumFile } from "./types";

const mp3tagMock = vi.hoisted(() => ({
  instances: [] as Array<{
    tags: {
      title?: string;
      artist?: string;
      album?: string;
      year?: string;
      genre?: string;
      track?: string;
      v2?: {
        APIC?: Array<{
          format: string;
          type: number;
          description: string;
          data: number[];
        }>;
      };
    };
    error?: string;
    buffer?: ArrayBuffer;
    read: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  }>,
  nextTags: {
    title: "Track Title",
    artist: "Artist",
    album: "Album",
    year: "2024",
    genre: "Electronic",
    track: "3/12",
    v2: {
      APIC: [
        {
          format: "image/png",
          type: 3,
          description: "cover",
          data: [1, 2, 3],
        },
      ],
    },
  },
  nextReadError: undefined as string | undefined,
}));

const validMp3Bytes = () => {
  const bytes = new Uint8Array(834);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 417);
  return bytes;
};

vi.mock("mp3tag.js", () => ({
  default: class MP3Tag {
    tags = structuredClone(mp3tagMock.nextTags);
    error = mp3tagMock.nextReadError;
    buffer: ArrayBuffer | undefined = new Uint8Array([9, 8, 7]).buffer;
    read = vi.fn();
    save = vi.fn();

    constructor() {
      mp3tagMock.instances.push(this);
    }
  },
}));

const metadata = (overrides: Partial<AudioMetadata> = {}): AudioMetadata => ({
  filename: "track",
  title: "Track",
  artist: "Artist",
  album: "Album",
  year: 2024,
  genre: "",
  duration: 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  trackNumber: null,
  ...overrides,
});

const tagiumFile = (overrides: Partial<TagiumFile> = {}): TagiumFile => ({
  id: "track-1",
  file: new File([validMp3Bytes()], "track-1.mp3", { type: "audio/mpeg" }),
  originalFile: new File([validMp3Bytes()], "track-1.mp3", { type: "audio/mpeg" }),
  filename: "track-1.mp3",
  status: "pending",
  downloadStatus: "ready",
  hasBufferedChanges: false,
  metadata: metadata(),
  ...overrides,
});

const audioMetadataRuntime = makeAudioRuntime(AudioMetadataIOLive);

const runAudioMetadataIO = <A, E>(effect: Effect.Effect<A, E, AudioMetadataIO>) =>
  audioMetadataRuntime.runPromise(effect);

const parseUploadedTracks = (uploadedFiles: File[]) =>
  runAudioMetadataIO(
    Effect.gen(function* () {
      const service = yield* AudioMetadataIO;
      return yield* service.parseUploadedTracks(uploadedFiles);
    }),
  );

const writeMetadataToFile = (fileToUpdate: TagiumFile, newTags: AudioMetadata) =>
  runAudioMetadataIO(
    Effect.gen(function* () {
      const service = yield* AudioMetadataIO;
      return yield* service.writeMetadataToFile(fileToUpdate, newTags);
    }),
  );

beforeEach(() => {
  mp3tagMock.instances = [];
  mp3tagMock.nextReadError = undefined;
  vi.stubGlobal(
    "Audio",
    class AudioMock {
      src = "";
      onloadedmetadata: (() => void) | null = null;
      onerror: (() => void) | null = null;
      duration = 123;

      constructor() {
        queueMicrotask(() => this.onloadedmetadata?.());
      }
    },
  );
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:audio"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AudioMetadataIO", () => {
  it("parses uploaded tracks through mp3tag and converts APIC bytes", async () => {
    const [upload] = await parseUploadedTracks([
      new File([validMp3Bytes()], "artist.track.mp3", { type: "audio/mpeg" }),
    ]);

    expect(upload.file.status).toBe("pending");
    expect(upload.file.metadata).toMatchObject({
      filename: "artist.track",
      title: "Track Title",
      artist: "Artist",
      album: "Album",
      year: 2024,
      genre: "Electronic",
      duration: 123,
      trackNumber: 3,
    });
    expect(upload.file.metadata?.picture[0]?.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(upload.file.metadata?.picture[0]?.data ?? [])).toEqual([1, 2, 3]);
    expect(upload.albumSeed.cover).toBe(upload.file.metadata?.picture);
  });

  it("normalizes missing numeric tags to null in parsed metadata snapshots", async () => {
    const originalTags = structuredClone(mp3tagMock.nextTags);
    const nextTags = mp3tagMock.nextTags as Partial<typeof mp3tagMock.nextTags>;
    delete nextTags.year;
    delete nextTags.track;

    const [upload] = await parseUploadedTracks([
      new File([validMp3Bytes()], "untagged.mp3", { type: "audio/mpeg" }),
    ]);

    mp3tagMock.nextTags = originalTags;

    expect(upload.file.status).toBe("pending");
    expect(upload.file.metadata?.year).toBeNull();
    expect(upload.file.metadata?.trackNumber).toBeNull();
  });

  it("returns an error upload when metadata read fails", async () => {
    mp3tagMock.nextReadError = "Invalid ID3 tag";

    const [upload] = await parseUploadedTracks([
      new File([validMp3Bytes()], "broken.mp3", { type: "audio/mpeg" }),
    ]);

    expect(upload.file.status).toBe("error");
    expect(upload.file.downloadError).toBe("Invalid ID3 tag");
    expect(upload.albumSeed).toEqual({ title: "", artist: "", genre: "" });
  });

  it("returns an error upload when duration setup throws", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => {
        throw new Error("duration setup failed");
      }),
      revokeObjectURL: vi.fn(),
    });

    const [upload] = await parseUploadedTracks([
      new File([validMp3Bytes()], "duration-failure.mp3", { type: "audio/mpeg" }),
    ]);

    expect(upload.file.status).toBe("error");
    expect(upload.file.downloadError).toBe("duration setup failed");
    expect(upload.albumSeed).toEqual({ title: "", artist: "", genre: "" });
  });

  it("writes cleared numeric metadata as empty strings and cover bytes as arrays", async () => {
    const updatedFile = await writeMetadataToFile(
      tagiumFile(),
      metadata({
        filename: "written",
        year: Number.NaN,
        trackNumber: null,
        picture: [
          {
            format: "image/jpeg",
            type: 3,
            description: "",
            data: new Uint8Array([4, 5, 6]),
          },
        ],
      }),
    );

    expect(updatedFile.name).toBe("written.mp3");
    expect(mp3tagMock.instances[0]?.tags).toMatchObject({
      title: "Track",
      artist: "Artist",
      album: "Album",
      year: "",
      track: "",
      v2: {
        APIC: [
          {
            format: "image/jpeg",
            type: 3,
            description: "",
            data: [4, 5, 6],
          },
        ],
      },
    });
  });

  it("rejects writes while the audio file is still downloading", async () => {
    await expect(writeMetadataToFile(tagiumFile({ file: undefined }), metadata())).rejects.toThrow(
      "audio file is still downloading.",
    );
  });
});
