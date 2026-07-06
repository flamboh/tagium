import { AudioMetadata, TagiumFile } from "./types";

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

export const toGenreString = (genre: AudioMetadata["genre"] | undefined) => {
  if (!genre) return "";
  return Array.isArray(genre) ? genre.join(", ") : genre;
};

const getValidTrackNumber = (trackNumber: AudioMetadata["trackNumber"] | undefined) => {
  if (!trackNumber) return undefined;
  if (!Number.isInteger(trackNumber)) return undefined;
  if (trackNumber < 1) return undefined;
  return trackNumber;
};

const compareTrackNumbers = (
  leftTrackNumber: AudioMetadata["trackNumber"] | undefined,
  rightTrackNumber: AudioMetadata["trackNumber"] | undefined,
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
