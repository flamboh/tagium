import { Schema } from "effect";
import { audioMetadataSchema } from "./metadata";
import { AudioMetadata, TagiumFile } from "./types";

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

const decodeAudioMetadata = Schema.decodeUnknownSync(audioMetadataSchema);

export interface UploadedTrack {
  file: TagiumFile;
  albumSeed: {
    title: string;
    artist: string;
    genre: string;
    cover?: AudioMetadata["picture"];
  };
}

export const parseTrackTagNumber = (value: string | undefined) => {
  if (!value) return undefined;
  const [head] = value.split("/");
  const trimmed = head?.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed < 1 ? undefined : parsed;
};

const parseTagNumber = (value: string | undefined) => {
  if (!value) return undefined;
  const [head] = value.split("/");
  const parsed = Number.parseInt(head ?? "", 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

export const toGenreString = (genre: AudioMetadata["genre"] | undefined) => {
  if (!genre) return "";
  return Array.isArray(genre) ? genre.join(", ") : genre;
};

const getValidTrackNumber = (trackNumber: AudioMetadata["trackNumber"]) => {
  if (!trackNumber) return undefined;
  if (!Number.isInteger(trackNumber)) return undefined;
  if (trackNumber < 1) return undefined;
  return trackNumber;
};

const compareTrackNumbers = (
  leftTrackNumber: AudioMetadata["trackNumber"],
  rightTrackNumber: AudioMetadata["trackNumber"],
) => {
  const leftValidTrackNumber = getValidTrackNumber(leftTrackNumber);
  const rightValidTrackNumber = getValidTrackNumber(rightTrackNumber);

  if (leftValidTrackNumber !== undefined && rightValidTrackNumber !== undefined) {
    return leftValidTrackNumber - rightValidTrackNumber;
  }
  if (leftValidTrackNumber !== undefined) return -1;
  if (rightValidTrackNumber !== undefined) return 1;
  return 0;
};

export const sortUploadedTracksByTrackNumber = (uploads: UploadedTrack[]) =>
  [...uploads].sort((left, right) => {
    return compareTrackNumbers(left.file.metadata?.trackNumber, right.file.metadata?.trackNumber);
  });

export const sortTrackIdsByTrackNumber = (trackIds: string[], files: TagiumFile[]) => {
  const filesById = new Map(files.map((file) => [file.id, file]));
  return [...trackIds].sort((leftId, rightId) => {
    return compareTrackNumbers(
      filesById.get(leftId)?.metadata?.trackNumber,
      filesById.get(rightId)?.metadata?.trackNumber,
    );
  });
};

const getDuration = async (file: File) =>
  new Promise<number>((resolve) => {
    const audio = new Audio(URL.createObjectURL(file));
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(audio.src);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(audio.src);
      resolve(0);
    };
  });

export async function parseUploadedTracks(uploadedFiles: File[]) {
  const parsedUploads: UploadedTrack[] = [];
  const MP3Tag = (await import("mp3tag.js")).default;

  for (const file of uploadedFiles) {
    const id = crypto.randomUUID();

    try {
      const arrayBuffer = await file.arrayBuffer();
      const mp3tag = new MP3Tag(arrayBuffer, false) as unknown as MP3TagReader;
      mp3tag.read();

      if (mp3tag.error) {
        throw new Error(mp3tag.error);
      }

      const duration = await getDuration(file);
      const pictureData =
        mp3tag.tags.v2?.APIC?.map((picture) => ({
          format: picture.format,
          type: picture.type,
          description: picture.description,
          data: new Uint8Array(picture.data),
        })) ?? [];

      const metadata = decodeAudioMetadata({
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

      parsedUploads.push({
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
      });
    } catch (error) {
      console.error(`error parsing metadata for ${file.name}:`, error);
      parsedUploads.push({
        file: {
          id,
          file,
          originalFile: file,
          filename: file.name,
          status: "error",
          downloadStatus: "ready",
          downloadError: error instanceof Error ? error.message : "unable to parse audio metadata.",
          hasBufferedChanges: false,
        },
        albumSeed: {
          title: "",
          artist: "",
          genre: "",
        },
      });
    }
  }

  return parsedUploads;
}

export async function writeMetadataToFile(fileToUpdate: TagiumFile, newTags: AudioMetadata) {
  if (!fileToUpdate.file) {
    throw new Error("audio file is still downloading.");
  }

  const metadataToWrite = decodeAudioMetadata(newTags);
  const MP3Tag = (await import("mp3tag.js")).default;
  const arrayBuffer = await fileToUpdate.file.arrayBuffer();
  const mp3tag = new MP3Tag(arrayBuffer, true) as unknown as MP3TagReader;

  mp3tag.read();
  if (mp3tag.error) {
    throw new Error(mp3tag.error);
  }

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

  mp3tag.save?.();
  if (mp3tag.error || !mp3tag.buffer) {
    throw new Error(mp3tag.error || "unable to save metadata");
  }

  return new File(
    [new Uint8Array(mp3tag.buffer)],
    metadataToWrite.filename ? `${metadataToWrite.filename}.mp3` : fileToUpdate.filename,
    {
      type: fileToUpdate.file.type,
    },
  );
}
