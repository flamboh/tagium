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

export interface UploadedTrack {
  file: TagiumFile;
  albumSeed: {
    title: string;
    artist: string;
    genre: string;
    cover?: AudioMetadata["picture"];
  };
}

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

      const metadata: AudioMetadata = {
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
        trackNumber: parseTagNumber(mp3tag.tags.track),
      };

      parsedUploads.push({
        file: {
          id,
          file,
          originalFile: file,
          filename: file.name,
          status: "pending",
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
      console.error(`Error parsing metadata for ${file.name}:`, error);
      parsedUploads.push({
        file: {
          id,
          file,
          originalFile: file,
          filename: file.name,
          status: "error",
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
  const MP3Tag = (await import("mp3tag.js")).default;
  const arrayBuffer = await fileToUpdate.file.arrayBuffer();
  const mp3tag = new MP3Tag(arrayBuffer, true) as unknown as MP3TagReader;

  mp3tag.read();
  if (mp3tag.error) {
    throw new Error(mp3tag.error);
  }

  mp3tag.tags.title = newTags.title || "";
  mp3tag.tags.artist = newTags.artist || "";
  mp3tag.tags.album = newTags.album || "";
  mp3tag.tags.year =
    newTags.year !== null && newTags.year !== undefined && !Number.isNaN(newTags.year)
      ? newTags.year.toString()
      : "";
  mp3tag.tags.genre = toGenreString(newTags.genre);
  mp3tag.tags.track =
    newTags.trackNumber !== null &&
    newTags.trackNumber !== undefined &&
    !Number.isNaN(newTags.trackNumber)
      ? newTags.trackNumber.toString()
      : "";

  if (newTags.picture && newTags.picture.length > 0 && mp3tag.tags.v2) {
    mp3tag.tags.v2.APIC = newTags.picture.map((picture) => ({
      format: picture.format || "image/jpeg",
      type: typeof picture.type === "number" ? picture.type : 3,
      description: picture.description || "",
      data: Array.from(picture.data),
    }));
  }

  mp3tag.save?.();
  if (mp3tag.error || !mp3tag.buffer) {
    throw new Error(mp3tag.error || "Unable to save metadata");
  }

  return new File(
    [new Uint8Array(mp3tag.buffer)],
    newTags.filename ? `${newTags.filename}.mp3` : fileToUpdate.filename,
    {
      type: fileToUpdate.file.type,
    },
  );
}
