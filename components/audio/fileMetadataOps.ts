import filenamify from "filenamify";
import { AlbumGroup, AudioMetadata, TagiumFile } from "./types";

export interface DownloadedTrackHydration {
  hydratedFile: TagiumFile;
  metadataToWrite?: AudioMetadata;
}

const mergeLatestMetadataWithHydratedTechnicalFields = (
  latestFile: TagiumFile,
  hydratedFile: TagiumFile,
) => {
  if (!latestFile.metadata) return hydratedFile.metadata;
  if (!hydratedFile.metadata) return latestFile.metadata;

  return {
    ...latestFile.metadata,
    duration: hydratedFile.metadata.duration,
    bitrate: hydratedFile.metadata.bitrate,
    sampleRate: hydratedFile.metadata.sampleRate,
    picture:
      latestFile.metadata.picture.length > 0
        ? latestFile.metadata.picture
        : hydratedFile.metadata.picture,
  };
};

export function applyTrackOrderNumbersToFiles(
  files: TagiumFile[],
  albums: AlbumGroup[],
  albumIdsToSync: string[],
) {
  const numbersByTrackId = new Map<string, number>();

  for (const albumId of albumIdsToSync) {
    const album = albums.find((entry) => entry.id === albumId);
    if (!album) continue;
    album.trackIds.forEach((trackId, index) => {
      numbersByTrackId.set(trackId, index + 1);
    });
  }

  if (numbersByTrackId.size === 0) return files;

  return files.map((file) => {
    const trackNumber = numbersByTrackId.get(file.id);
    if (trackNumber === undefined || !file.metadata) return file;

    return {
      ...file,
      status: file.status === "saved" ? "pending" : file.status,
      hasBufferedChanges: true,
      metadata: {
        ...file.metadata,
        trackNumber,
      },
    };
  });
}

export function applyAlbumSharedTagsToFiles(files: TagiumFile[], album: AlbumGroup) {
  if (album.trackIds.length === 0) return files;

  const trackSet = new Set(album.trackIds);
  const trackIndex = new Map(album.trackIds.map((trackId, index) => [trackId, index + 1]));

  return files.map((file) => {
    if (!trackSet.has(file.id) || !file.metadata) return file;

    const syncedFilename = album.syncFilenames
      ? filenamify(file.metadata.title, { replacement: "-" })
      : undefined;
    return {
      ...file,
      filename: syncedFilename ?? file.filename,
      status: file.status === "saved" ? "pending" : file.status,
      hasBufferedChanges: true,
      metadata: {
        ...file.metadata,
        artist: album.artist,
        album: album.title,
        genre: album.genre,
        year: album.year !== undefined ? album.year : file.metadata.year,
        picture: album.cover && album.cover.length > 0 ? album.cover : file.metadata.picture,
        trackNumber: album.syncTrackNumbers ? trackIndex.get(file.id) : file.metadata.trackNumber,
        filename: syncedFilename ?? file.metadata.filename,
      },
    };
  });
}

export function prepareDownloadedTrackHydration(
  currentFile: TagiumFile,
  parsedFile: TagiumFile,
  formMetadata?: AudioMetadata,
): DownloadedTrackHydration {
  const parsedMetadata = parsedFile.metadata;
  const bufferedMetadata = formMetadata ?? currentFile.metadata;
  const shouldApplyBufferedMetadata = currentFile.hasBufferedChanges || Boolean(formMetadata);
  const nextMetadata =
    shouldApplyBufferedMetadata && bufferedMetadata
      ? {
          ...bufferedMetadata,
          duration: parsedMetadata?.duration ?? bufferedMetadata.duration,
          bitrate: parsedMetadata?.bitrate ?? bufferedMetadata.bitrate,
          sampleRate: parsedMetadata?.sampleRate ?? bufferedMetadata.sampleRate,
          picture:
            bufferedMetadata.picture.length > 0
              ? bufferedMetadata.picture
              : (parsedMetadata?.picture ?? []),
        }
      : (parsedMetadata ?? currentFile.metadata);

  const hydratedFile: TagiumFile = {
    ...currentFile,
    file: parsedFile.file,
    originalFile: parsedFile.originalFile,
    filename:
      shouldApplyBufferedMetadata && nextMetadata?.filename
        ? `${nextMetadata.filename}.mp3`
        : parsedFile.filename,
    metadata: nextMetadata,
    downloadStatus: "ready",
    downloadError: parsedFile.downloadError,
    status: shouldApplyBufferedMetadata ? "pending" : parsedFile.status,
    hasBufferedChanges: shouldApplyBufferedMetadata,
  };

  return {
    hydratedFile,
    metadataToWrite: shouldApplyBufferedMetadata ? nextMetadata : undefined,
  };
}

export function resolveDownloadedTrackHydrationWrite(
  currentFile: TagiumFile,
  latestFile: TagiumFile,
  parsedFile: TagiumFile,
  hydratedFile: TagiumFile,
  updatedFile: File,
  metadataToWrite: AudioMetadata,
  latestFormMetadata?: AudioMetadata,
) {
  if (latestFile !== currentFile || latestFormMetadata) {
    const nextFile = latestFormMetadata
      ? {
          ...latestFile,
          filename: `${latestFormMetadata.filename}.mp3`,
          metadata: latestFormMetadata,
        }
      : latestFile;

    return {
      ...nextFile,
      file: updatedFile,
      originalFile: parsedFile.originalFile,
      metadata: mergeLatestMetadataWithHydratedTechnicalFields(nextFile, hydratedFile),
      downloadStatus: "ready" as const,
      downloadError: undefined,
      status: "pending" as const,
      hasBufferedChanges: true,
    };
  }

  return {
    ...hydratedFile,
    file: updatedFile,
    filename: updatedFile.name,
    metadata: {
      ...metadataToWrite,
      filename: metadataToWrite.filename,
    },
    status: "saved" as const,
    hasBufferedChanges: false,
  };
}

export function resolveDownloadedTrackHydrationWriteError(
  currentFile: TagiumFile,
  latestFile: TagiumFile,
  parsedFile: TagiumFile,
  hydratedFile: TagiumFile,
  errorMessage: string,
) {
  const nextFile = latestFile !== currentFile ? latestFile : hydratedFile;

  return {
    ...nextFile,
    file: parsedFile.file,
    originalFile: parsedFile.originalFile,
    metadata: mergeLatestMetadataWithHydratedTechnicalFields(nextFile, hydratedFile),
    downloadStatus: "ready" as const,
    downloadError: errorMessage,
    status: "error" as const,
    hasBufferedChanges: true,
  };
}
