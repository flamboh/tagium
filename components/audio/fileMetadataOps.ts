import filenamify from "filenamify";
import type { SoundCloudSet } from "./soundcloudSet";
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

export function applySyncedFilenamesToFiles(files: TagiumFile[], trackIds?: string[]) {
  const trackIdSet = trackIds ? new Set(trackIds) : undefined;

  return files.map((file) => {
    if (trackIdSet && !trackIdSet.has(file.id)) return file;
    if (!file.metadata) return file;

    const syncedFilename = filenamify(file.metadata.title, { replacement: "-" });
    if (!syncedFilename) return file;
    if (file.filename === `${syncedFilename}.mp3` && file.metadata.filename === syncedFilename) {
      return file;
    }

    return {
      ...file,
      filename: `${syncedFilename}.mp3`,
      status: file.status === "saved" ? "pending" : file.status,
      hasBufferedChanges: true,
      metadata: {
        ...file.metadata,
        filename: syncedFilename,
      },
    };
  });
}

export function applyAlbumSharedTagsToFiles(files: TagiumFile[], album: AlbumGroup) {
  if (album.trackIds.length === 0) return files;

  const trackSet = new Set(album.trackIds);

  return files.map((file) => {
    if (!trackSet.has(file.id) || !file.metadata) return file;

    return {
      ...file,
      status: file.status === "saved" ? "pending" : file.status,
      hasBufferedChanges: true,
      metadata: {
        ...file.metadata,
        artist: album.artist,
        album: album.title,
        genre: album.genre,
        year: album.year !== undefined ? album.year : file.metadata.year,
      },
    };
  });
}

export function applyAlbumCoverToFiles(
  files: TagiumFile[],
  trackIds: string[],
  cover: AudioMetadata["picture"],
) {
  if (trackIds.length === 0 || cover.length === 0) return files;

  const trackSet = new Set(trackIds);

  return files.map((file) => {
    if (!trackSet.has(file.id) || !file.metadata) return file;

    return {
      ...file,
      status: file.status === "saved" ? "pending" : file.status,
      hasBufferedChanges: true,
      metadata: {
        ...file.metadata,
        picture: cover,
      },
    };
  });
}

export function applyAlbumCoverToFilesWithSelectedMetadata(
  files: TagiumFile[],
  trackIds: string[],
  cover: AudioMetadata["picture"],
  selectedFileId: string | null,
): { files: TagiumFile[]; selectedMetadata?: AudioMetadata } {
  const coveredFiles = applyAlbumCoverToFiles(files, trackIds, cover);
  if (!selectedFileId) {
    return { files: coveredFiles };
  }
  if (!trackIds.includes(selectedFileId)) {
    return { files: coveredFiles };
  }

  const selectedFile = coveredFiles.find((file) => file.id === selectedFileId);
  return {
    files: coveredFiles,
    selectedMetadata: selectedFile?.metadata,
  };
}

function arePicturesEqual(
  firstPicture: AudioMetadata["picture"] | undefined,
  secondPicture: AudioMetadata["picture"] | undefined,
) {
  const [firstCover] = firstPicture ?? [];
  const [secondCover] = secondPicture ?? [];

  if (!firstCover || !secondCover) return !firstCover && !secondCover;
  if (firstCover.format !== secondCover.format) return false;
  if (firstCover.data.length !== secondCover.data.length) return false;

  for (let index = 0; index < firstCover.data.length; index += 1) {
    if (firstCover.data[index] !== secondCover.data[index]) return false;
  }

  return true;
}

export function areAlbumTrackCoversSynced(
  files: TagiumFile[],
  trackIds: string[],
  albumCover: AudioMetadata["picture"] | undefined,
) {
  if (trackIds.length === 0) return false;

  return trackIds.every((trackId) => {
    const file = files.find((currentFile) => currentFile.id === trackId);
    if (!file?.metadata) return false;

    return arePicturesEqual(file.metadata.picture, albumCover);
  });
}

export function applySoundCloudSetImportedCover(
  files: TagiumFile[],
  albums: AlbumGroup[],
  albumId: string,
  trackIds: string[],
  set: Pick<SoundCloudSet, "isAlbum">,
  settings: { applySoundCloudAlbumCoverToTracks: boolean },
  cover: AudioMetadata["picture"],
  selectedFileId: string | null,
) {
  const coveredAlbums = albums.map((currentAlbum) =>
    currentAlbum.id === albumId ? { ...currentAlbum, cover } : currentAlbum,
  );

  if (!set.isAlbum || !settings.applySoundCloudAlbumCoverToTracks) {
    return { albums: coveredAlbums, files };
  }

  return {
    albums: coveredAlbums,
    ...applyAlbumCoverToFilesWithSelectedMetadata(files, trackIds, cover, selectedFileId),
  };
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
