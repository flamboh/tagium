import { Effect } from "effect";
import { AudioMetadataWriteError } from "@/features/audio/audioErrors";
import { audioFilenameBase, audioFilename } from "@/features/audio/audioFormat";
import type { AudioMetadata } from "@/features/audio/metadata";
import { makeBlobByteSource } from "@/features/audio/metadataEngine/byteSource";
import { detectAudioFormat } from "@/features/audio/metadataEngine/detect";
import type { FormatDriver } from "@/features/audio/metadataEngine/driver";
import { flacDriver } from "@/features/audio/metadataEngine/flac";
import { mp3Driver } from "@/features/audio/metadataEngine/mp3/mp3Driver";
import { mp4Driver } from "@/features/audio/metadataEngine/mp4";
import type {
  ArtworkEntry,
  AudioInspection,
  MetadataChanges,
} from "@/features/audio/metadataEngine/types";

const drivers = {
  mp3: mp3Driver,
  flac: flacDriver,
  m4a: mp4Driver,
} as const satisfies Record<string, FormatDriver>;

const sourceFormat = (driver: FormatDriver, filename: string) =>
  driver.format.kind === "m4a" && /\.mp4$/iu.test(filename)
    ? { ...driver.format, extension: "mp4" as const }
    : driver.format;

const inspectFile = (file: File) =>
  Effect.gen(function* () {
    const source = makeBlobByteSource(file);
    const kind = yield* detectAudioFormat(source);
    const driver = drivers[kind];
    const inspection = yield* driver.inspect(source);
    return { ...inspection, format: sourceFormat(driver, file.name) };
  });

const artworkEqual = (left: ArtworkEntry[], right: ArtworkEntry[]) => {
  if (left.length !== right.length) return false;
  return left.every((picture, index) => {
    const other = right[index];
    if (
      !other ||
      picture.format !== other.format ||
      picture.type !== other.type ||
      picture.description !== other.description ||
      picture.data.length !== other.data.length
    )
      return false;
    return picture.data.every((byte, byteIndex) => byte === other.data[byteIndex]);
  });
};

const genreEqual = (left: string | string[], right: string | string[]) =>
  Array.isArray(left) === Array.isArray(right) &&
  (Array.isArray(left) && Array.isArray(right)
    ? left.length === right.length && left.every((value, index) => value === right[index])
    : left === right);

const validateEditableNumbers = (metadata: Pick<AudioMetadata, "year" | "trackNumber">) => {
  const validInteger = (value: number | null) =>
    value === null || (Number.isFinite(value) && Number.isInteger(value));
  if (
    !validInteger(metadata.year) ||
    (metadata.year !== null && (metadata.year < 0 || metadata.year > 9999))
  ) {
    return new AudioMetadataWriteError({
      message: "year must be a whole number from 0 to 9999.",
      cause: undefined,
    });
  }
  if (
    !validInteger(metadata.trackNumber) ||
    (metadata.trackNumber !== null && (metadata.trackNumber < 1 || metadata.trackNumber > 65_535))
  ) {
    return new AudioMetadataWriteError({
      message: "track number must be a whole number from 1 to 65535.",
      cause: undefined,
    });
  }
};

export const diffEditableMetadata = (
  current: AudioInspection["metadata"],
  next: AudioMetadata,
): MetadataChanges => {
  const changes: MetadataChanges = {};
  if (current.title !== next.title) changes.title = next.title;
  if (current.artist !== next.artist) changes.artist = next.artist;
  if (current.album !== next.album) changes.album = next.album;
  if (current.year !== next.year) changes.year = next.year;
  if (!genreEqual(current.genre, next.genre)) changes.genre = next.genre;
  if (current.trackNumber !== next.trackNumber) changes.trackNumber = next.trackNumber;
  if (!artworkEqual(current.picture, next.picture)) {
    // The current UI edits the primary cover only. Keep secondary artwork unless the
    // caller explicitly supplies a complete multi-picture replacement.
    changes.picture =
      next.picture.length <= 1 && current.picture.length > 1
        ? [...next.picture, ...current.picture.slice(1)]
        : next.picture;
  }
  return changes;
};

export const inspectAudioFile = (file: File) =>
  inspectFile(file).pipe(
    Effect.map((inspection) => ({
      inspection,
      metadata: {
        filename: audioFilenameBase(file.name),
        ...inspection.metadata,
      } satisfies AudioMetadata,
    })),
  );

export const patchAudioFile = (file: File, metadata: AudioMetadata) =>
  Effect.gen(function* () {
    const validationError = validateEditableNumbers(metadata);
    if (validationError) return yield* Effect.fail(validationError);
    const source = makeBlobByteSource(file);
    const kind = yield* detectAudioFormat(source).pipe(
      Effect.mapError(
        (error) => new AudioMetadataWriteError({ message: error.message, cause: error }),
      ),
    );
    const driver = drivers[kind];
    const inspection = yield* driver
      .inspect(source)
      .pipe(
        Effect.mapError(
          (error) => new AudioMetadataWriteError({ message: error.message, cause: error }),
        ),
      );
    const changes = diffEditableMetadata(inspection.metadata, metadata);
    const plan = yield* driver.patch(source, changes);
    return new File(plan.parts, audioFilename(metadata.filename, sourceFormat(driver, file.name)), {
      type: plan.type,
      lastModified: file.lastModified,
    });
  });

export const patchAudioFileWithChanges = (
  file: File,
  changes: MetadataChanges,
  filenameBase: string,
) =>
  Effect.gen(function* () {
    const source = makeBlobByteSource(file);
    const kind = yield* detectAudioFormat(source).pipe(
      Effect.mapError(
        (error) => new AudioMetadataWriteError({ message: error.message, cause: error }),
      ),
    );
    const driver = drivers[kind];
    const plan = yield* driver.patch(source, changes);
    return new File(plan.parts, audioFilename(filenameBase, sourceFormat(driver, file.name)), {
      type: plan.type,
      lastModified: file.lastModified,
    });
  });
