import { Context, Effect, Layer, Schema } from "effect";
import {
  AudioMetadataReadError,
  AudioMetadataWriteError,
  toPublicAudioError,
} from "@/features/audio/audioErrors";
import { audioMetadataSchema } from "@/features/audio/metadata";
import { parseTrackTagNumber, toGenreString, type UploadedTrack } from "@/features/audio/mp3Utils";
import type { AudioMetadata, TagiumFile } from "@/features/library/types";
import {
  getAudioFormatInfo,
  withAudioExtension,
  withoutAudioExtension,
} from "@/features/audio/audioFormat";
import {
  getMp3AdmissionError,
  normalizeMp3File,
  normalizeMp3Filename,
} from "@/features/audio/mp3Compatibility";

interface MP3TagPicture {
  format: string;
  type: number;
  description: string;
  data: number[];
}

interface MP3TagComment {
  language: string;
  descriptor: string;
  text: string;
}

interface MP3TagReader {
  read: (options?: { unsupported?: boolean }) => void;
  save?: (options?: { id3v2?: { unsupported?: boolean } }) => void;
  error?: string;
  buffer?: ArrayBuffer;
  tags: {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    track?: string;
    comment?: string;
    v1?: { comment?: string; [field: string]: unknown };
    v2?: {
      APIC?: MP3TagPicture[];
      TPE2?: string;
      TP2?: string;
      TCOM?: string;
      TCM?: string;
      TBPM?: string;
      TBP?: string;
      TPOS?: string;
      TPA?: string;
      COMM?: MP3TagComment[];
      COM?: MP3TagComment[];
      [frame: string]: unknown;
    };
    v2Details?: {
      version: number[];
      size?: number;
      flags?: {
        unsynchronisation: boolean;
        extendedHeader: boolean;
        experimentalIndicator: boolean;
      };
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

const toTagNumber = (value: number | null) =>
  value !== null && !Number.isNaN(value) ? value.toString() : "";

const setVersionedTextFrame = (
  tags: NonNullable<MP3TagReader["tags"]["v2"]>,
  version: number | undefined,
  frame: "TPE2" | "TCOM" | "TBPM" | "TPOS",
  legacyFrame: "TP2" | "TCM" | "TBP" | "TPA",
  value: string,
) => {
  if (version === 2) {
    tags[legacyFrame] = value;
    delete tags[frame];
    return;
  }
  tags[frame] = value;
  delete tags[legacyFrame];
};

const ensureId3v2 = (tags: MP3TagReader["tags"]) => {
  tags.v2 ??= {};
  tags.v2Details ??= {
    version: [4, 0],
    size: 0,
    flags: {
      unsynchronisation: false,
      extendedHeader: false,
      experimentalIndicator: false,
    },
  };
  return { frames: tags.v2, version: tags.v2Details.version[0] };
};

const setComment = (tags: MP3TagReader["tags"], value: string) => {
  const { frames, version } = ensureId3v2(tags);
  const frame = version === 2 ? "COM" : "COMM";
  const legacyFrame = version === 2 ? "COMM" : "COM";
  const comments = (frames[frame] as MP3TagComment[] | undefined) ?? [];
  const primaryIndex = comments.findIndex(
    (comment) => comment.language === "eng" && comment.descriptor === "",
  );
  const primary = { language: "eng", descriptor: "", text: value };
  frames[frame] = [primary, ...comments.filter((_, index) => index !== primaryIndex)];
  delete frames[legacyFrame];
  if (tags.v1) tags.v1.comment = value;
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
      mp3tag.read({ unsupported: true });
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
      mp3tag.save?.({ id3v2: { unsupported: true } });
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
      const arrayBuffer = yield* readArrayBuffer(file);
      const admissionError = getMp3AdmissionError(file, new Uint8Array(arrayBuffer));
      if (admissionError) {
        return yield* Effect.fail(
          new AudioMetadataReadError({ message: admissionError, cause: undefined }),
        );
      }
      const normalizedFile = normalizeMp3File(file);
      const MP3Tag = yield* loadMP3Tag;
      const mp3tag = yield* readMp3Tags(MP3Tag, arrayBuffer, false);
      const duration = yield* getDuration(normalizedFile);
      const pictureData =
        mp3tag.tags.v2?.APIC?.map((picture) => ({
          format: picture.format,
          type: picture.type,
          description: picture.description,
          data: new Uint8Array(picture.data),
        })) ?? [];

      const metadata = yield* decodeReadMetadata({
        filename: withoutAudioExtension(normalizeMp3Filename(file.name), "mp3"),
        title: mp3tag.tags.title || "",
        artist: mp3tag.tags.artist || "",
        albumArtist: mp3tag.tags.v2?.TPE2 || mp3tag.tags.v2?.TP2 || mp3tag.tags.artist || "",
        album: mp3tag.tags.album || "",
        year: parseTagNumber(mp3tag.tags.year) ?? null,
        genre: mp3tag.tags.genre || "",
        duration,
        bitrate: 0,
        sampleRate: 0,
        picture: pictureData,
        trackNumber: parseTrackTagNumber(mp3tag.tags.track) ?? null,
        discNumber: parseTagNumber(mp3tag.tags.v2?.TPOS || mp3tag.tags.v2?.TPA) ?? null,
        composer: mp3tag.tags.v2?.TCOM || mp3tag.tags.v2?.TCM || "",
        bpm: parseTagNumber(mp3tag.tags.v2?.TBPM || mp3tag.tags.v2?.TBP) ?? null,
        comment: mp3tag.tags.comment || "",
      });

      return {
        file: {
          id,
          format: "mp3",
          file: normalizedFile,
          originalFile: file,
          filename: normalizedFile.name,
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
            format: "mp3",
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

    const { frames: v2Frames, version: v2Version } = ensureId3v2(mp3tag.tags);
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
    setComment(mp3tag.tags, metadataToWrite.comment);

    {
      setVersionedTextFrame(v2Frames, v2Version, "TPE2", "TP2", metadataToWrite.albumArtist);
      setVersionedTextFrame(v2Frames, v2Version, "TCOM", "TCM", metadataToWrite.composer);
      setVersionedTextFrame(v2Frames, v2Version, "TBPM", "TBP", toTagNumber(metadataToWrite.bpm));
      setVersionedTextFrame(
        v2Frames,
        v2Version,
        "TPOS",
        "TPA",
        toTagNumber(metadataToWrite.discNumber),
      );
    }

    if (metadataToWrite.picture && metadataToWrite.picture.length > 0) {
      v2Frames.APIC = metadataToWrite.picture.map((picture) => ({
        format: picture.format || "image/jpeg",
        type: typeof picture.type === "number" ? picture.type : 3,
        description: picture.description || "",
        data: Array.from(picture.data),
      }));
    }

    const buffer = yield* saveMp3Tags(mp3tag);

    return new File(
      [new Uint8Array(buffer)],
      metadataToWrite.filename
        ? withAudioExtension(metadataToWrite.filename, fileToUpdate.format)
        : fileToUpdate.filename,
      {
        type: getAudioFormatInfo(fileToUpdate.format).mimeType,
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
