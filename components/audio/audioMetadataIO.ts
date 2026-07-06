import { Context, Effect, Layer, Schema } from "effect";
import { AudioMetadataReadError, AudioMetadataWriteError, toPublicAudioError } from "./audioErrors";
import { makeAudioRuntime } from "./audioRuntime";
import { audioMetadataSchema } from "./metadata";
import { parseTrackTagNumber, toGenreString, type UploadedTrack } from "./mp3Utils";
import type { AudioMetadata, TagiumFile } from "./types";

interface MP3TagPicture {
  format: string;
  type: number;
  description: string;
  data: number[];
}

interface MP3TagReader {
  read: () => void;
  save?: () => void;
  error?: string;
  buffer?: ArrayBuffer;
  tags: {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    track?: string;
    v2?: {
      APIC?: MP3TagPicture[];
    };
  };
}

type MP3TagConstructor = new (buffer: ArrayBuffer, verbose: boolean) => MP3TagReader;

const decodeAudioMetadata = Schema.decodeUnknownSync(audioMetadataSchema);

const toErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const parseTagNumber = (value: string | undefined) => {
  if (!value) return undefined;
  const [head] = value.split("/");
  const parsed = Number.parseInt(head ?? "", 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const getDuration = (file: File) =>
  Effect.tryPromise({
    try: () =>
      new Promise<number>((resolve) => {
        const audio = new Audio(URL.createObjectURL(file));
        const cleanup = () => URL.revokeObjectURL(audio.src);

        audio.onloadedmetadata = () => {
          cleanup();
          resolve(audio.duration);
        };
        audio.onerror = () => {
          cleanup();
          resolve(0);
        };
      }),
    catch: (cause) =>
      new AudioMetadataReadError({
        message: toErrorMessage(cause, "unable to read audio duration."),
        cause,
      }),
  });

const loadMP3Tag = Effect.tryPromise({
  try: async () => (await import("mp3tag.js")).default as unknown as MP3TagConstructor,
  catch: (cause) =>
    new AudioMetadataReadError({
      message: toErrorMessage(cause, "unable to load mp3 metadata parser."),
      cause,
    }),
});

const readArrayBuffer = (file: File) =>
  Effect.tryPromise({
    try: () => file.arrayBuffer(),
    catch: (cause) =>
      new AudioMetadataReadError({
        message: toErrorMessage(cause, "unable to read audio file."),
        cause,
      }),
  });

const decodeReadMetadata = (input: unknown) =>
  Effect.try({
    try: () => decodeAudioMetadata(input),
    catch: (cause) =>
      new AudioMetadataReadError({
        message: toErrorMessage(cause, "unable to parse audio metadata."),
        cause,
      }),
  });

const decodeWriteMetadata = (input: unknown) =>
  Effect.try({
    try: () => decodeAudioMetadata(input),
    catch: (cause) =>
      new AudioMetadataWriteError({
        message: toErrorMessage(cause, "unable to write audio metadata."),
        cause,
      }),
  });

const readMp3Tags = (MP3Tag: MP3TagConstructor, arrayBuffer: ArrayBuffer, verbose: boolean) =>
  Effect.try({
    try: () => {
      const mp3tag = new MP3Tag(arrayBuffer, verbose);
      mp3tag.read();
      if (mp3tag.error) throw new Error(mp3tag.error);
      return mp3tag;
    },
    catch: (cause) =>
      new AudioMetadataReadError({
        message: toErrorMessage(cause, "unable to parse audio metadata."),
        cause,
      }),
  });

const saveMp3Tags = (mp3tag: MP3TagReader) =>
  Effect.try({
    try: () => {
      mp3tag.save?.();
      if (mp3tag.error || !mp3tag.buffer) {
        throw new Error(mp3tag.error || "unable to save metadata");
      }
      return mp3tag.buffer;
    },
    catch: (cause) =>
      new AudioMetadataWriteError({
        message: toErrorMessage(cause, "unable to save metadata"),
        cause,
      }),
  });

const parseUploadedTrack = (file: File) =>
  Effect.gen(function* () {
    const id = crypto.randomUUID();

    return yield* Effect.gen(function* () {
      const MP3Tag = yield* loadMP3Tag;
      const arrayBuffer = yield* readArrayBuffer(file);
      const mp3tag = yield* readMp3Tags(MP3Tag, arrayBuffer, false);
      const duration = yield* getDuration(file);
      const pictureData =
        mp3tag.tags.v2?.APIC?.map((picture) => ({
          format: picture.format,
          type: picture.type,
          description: picture.description,
          data: new Uint8Array(picture.data),
        })) ?? [];

      const metadata = yield* decodeReadMetadata({
        filename: file.name.split(".").slice(0, -1).join("."),
        title: mp3tag.tags.title || "",
        artist: mp3tag.tags.artist || "",
        album: mp3tag.tags.album || "",
        year: parseTagNumber(mp3tag.tags.year),
        genre: mp3tag.tags.genre || "",
        duration,
        bitrate: 0,
        sampleRate: 0,
        picture: pictureData,
        trackNumber: parseTrackTagNumber(mp3tag.tags.track),
      });

      return {
        file: {
          id,
          file,
          originalFile: file,
          filename: file.name,
          status: "pending",
          downloadStatus: "ready",
          hasBufferedChanges: false,
          metadata,
        },
        albumSeed: {
          title: metadata.album.trim(),
          artist: metadata.artist.trim(),
          genre: toGenreString(metadata.genre),
          cover: metadata.picture.length > 0 ? metadata.picture : undefined,
        },
      } satisfies UploadedTrack;
    }).pipe(
      Effect.catch((cause) => {
        const error = toPublicAudioError(cause);
        console.error(`error parsing metadata for ${file.name}:`, error);
        return Effect.succeed({
          file: {
            id,
            file,
            originalFile: file,
            filename: file.name,
            status: "error",
            downloadStatus: "ready",
            downloadError: error.message,
            hasBufferedChanges: false,
          },
          albumSeed: {
            title: "",
            artist: "",
            genre: "",
          },
        } satisfies UploadedTrack);
      }),
    );
  });

const writeMetadata = (fileToUpdate: TagiumFile, newTags: AudioMetadata) =>
  Effect.gen(function* () {
    if (!fileToUpdate.file) {
      return yield* Effect.fail(
        new AudioMetadataWriteError({
          message: "audio file is still downloading.",
          cause: undefined,
        }),
      );
    }

    const metadataToWrite = yield* decodeWriteMetadata(newTags);
    const MP3Tag = yield* loadMP3Tag.pipe(
      Effect.mapError(
        (error) =>
          new AudioMetadataWriteError({
            message: error.message,
            cause: error.cause,
          }),
      ),
    );
    const arrayBuffer = yield* readArrayBuffer(fileToUpdate.file).pipe(
      Effect.mapError(
        (error) =>
          new AudioMetadataWriteError({
            message: error.message,
            cause: error.cause,
          }),
      ),
    );
    const mp3tag = yield* readMp3Tags(MP3Tag, arrayBuffer, true).pipe(
      Effect.mapError(
        (error) =>
          new AudioMetadataWriteError({
            message: error.message,
            cause: error.cause,
          }),
      ),
    );

    mp3tag.tags.title = metadataToWrite.title || "";
    mp3tag.tags.artist = metadataToWrite.artist || "";
    mp3tag.tags.album = metadataToWrite.album || "";
    mp3tag.tags.year =
      metadataToWrite.year !== null &&
      metadataToWrite.year !== undefined &&
      !Number.isNaN(metadataToWrite.year)
        ? metadataToWrite.year.toString()
        : "";
    mp3tag.tags.genre = toGenreString(metadataToWrite.genre);
    mp3tag.tags.track =
      metadataToWrite.trackNumber !== null &&
      metadataToWrite.trackNumber !== undefined &&
      !Number.isNaN(metadataToWrite.trackNumber)
        ? metadataToWrite.trackNumber.toString()
        : "";

    if (metadataToWrite.picture && metadataToWrite.picture.length > 0 && mp3tag.tags.v2) {
      mp3tag.tags.v2.APIC = metadataToWrite.picture.map((picture) => ({
        format: picture.format || "image/jpeg",
        type: typeof picture.type === "number" ? picture.type : 3,
        description: picture.description || "",
        data: Array.from(picture.data),
      }));
    }

    const buffer = yield* saveMp3Tags(mp3tag);

    return new File(
      [new Uint8Array(buffer)],
      metadataToWrite.filename ? `${metadataToWrite.filename}.mp3` : fileToUpdate.filename,
      {
        type: fileToUpdate.file.type,
      },
    );
  });

export interface AudioMetadataIOService {
  readonly parseUploadedTracks: (uploadedFiles: File[]) => Effect.Effect<UploadedTrack[], never>;
  readonly writeMetadataToFile: (
    fileToUpdate: TagiumFile,
    newTags: AudioMetadata,
  ) => Effect.Effect<File, AudioMetadataWriteError>;
}

export class AudioMetadataIO extends Context.Service<AudioMetadataIO, AudioMetadataIOService>()(
  "AudioMetadataIO",
) {}

export const AudioMetadataIOLive = Layer.succeed(
  AudioMetadataIO,
  AudioMetadataIO.of({
    parseUploadedTracks: (uploadedFiles) =>
      Effect.forEach(uploadedFiles, parseUploadedTrack, { concurrency: 1 }),
    writeMetadataToFile: writeMetadata,
  }),
);

const audioMetadataRuntime = makeAudioRuntime(AudioMetadataIOLive);

export async function parseUploadedTracksWithMetadataIO(uploadedFiles: File[]) {
  const service = await audioMetadataRuntime.runPromise(AudioMetadataIO);
  return await audioMetadataRuntime.runPromise(service.parseUploadedTracks(uploadedFiles));
}

export async function writeMetadataToFileWithMetadataIO(
  fileToUpdate: TagiumFile,
  newTags: AudioMetadata,
) {
  const service = await audioMetadataRuntime.runPromise(AudioMetadataIO);
  return await audioMetadataRuntime.runPromise(
    service.writeMetadataToFile(fileToUpdate, newTags).pipe(Effect.mapError(toPublicAudioError)),
  );
}
