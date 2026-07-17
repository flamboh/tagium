import filenamify from "filenamify";
import type { Playlist } from "./playlist";
import type { SoundCloudSet } from "./soundcloudSet";
import type { AlbumGroup, AudioMetadata, MetadataPatch, TagiumFile } from "./types";

export interface DownloadedTrackHydration {
  hydratedFile: TagiumFile;
  metadataToWrite?: AudioMetadata;
}

type DownloadedTrackWritableMetadataField = keyof MetadataPatch;

export type DownloadedTrackMetadataPatch = MetadataPatch;

interface ReconciledDownloadedTrackMetadata {
  metadata?: AudioMetadata;
  metadataToWrite?: AudioMetadata;
}

const patchFields = [
  "filename",
  "title",
  "artist",
  "album",
  "year",
  "genre",
  "picture",
  "trackNumber",
] as const satisfies readonly DownloadedTrackWritableMetadataField[];

const nullableNumericPatchFields = ["year", "trackNumber"] as const;

const markPendingMetadataPatch = (
  file: TagiumFile,
  patch: DownloadedTrackMetadataPatch,
): TagiumFile => {
  const pendingMetadataPatch = {
    ...file.pendingMetadataPatch,
    ...patch,
  };

  return {
    ...file,
    pendingMetadataPatch,
    hasBufferedChanges: true,
  };
};

const createMetadataPatch = (metadata: AudioMetadata): DownloadedTrackMetadataPatch => ({
  filename: metadata.filename,
  title: metadata.title,
  artist: metadata.artist,
  album: metadata.album,
  year: metadata.year,
  genre: metadata.genre,
  picture: metadata.picture,
  trackNumber: metadata.trackNumber,
});

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

const hasOwn = <Key extends PropertyKey>(object: object, key: Key) =>
  Object.prototype.hasOwnProperty.call(object, key);

const areGenresEqual = (
  firstGenre: AudioMetadata["genre"],
  secondGenre: AudioMetadata["genre"],
) => {
  if (Array.isArray(firstGenre) || Array.isArray(secondGenre)) {
    if (!Array.isArray(firstGenre) || !Array.isArray(secondGenre)) return false;
    if (firstGenre.length !== secondGenre.length) return false;
    return firstGenre.every((genre, index) => genre === secondGenre[index]);
  }

  return firstGenre === secondGenre;
};

const areWritableMetadataFieldsEqual = (
  firstMetadata: AudioMetadata,
  secondMetadata: AudioMetadata,
) =>
  firstMetadata.filename === secondMetadata.filename &&
  firstMetadata.title === secondMetadata.title &&
  firstMetadata.artist === secondMetadata.artist &&
  firstMetadata.album === secondMetadata.album &&
  firstMetadata.year === secondMetadata.year &&
  areGenresEqual(firstMetadata.genre, secondMetadata.genre) &&
  arePicturesEqual(firstMetadata.picture, secondMetadata.picture) &&
  firstMetadata.trackNumber === secondMetadata.trackNumber;

const applyProviderDisplayMetadata = (
  parsedMetadata: AudioMetadata,
  providerMetadata?: AudioMetadata,
): AudioMetadata => {
  if (!providerMetadata) return parsedMetadata;

  return {
    ...parsedMetadata,
    filename: providerMetadata.filename || parsedMetadata.filename,
    title: providerMetadata.title || parsedMetadata.title,
    artist: providerMetadata.artist || parsedMetadata.artist,
    album: providerMetadata.album || parsedMetadata.album,
    genre: providerMetadata.genre || parsedMetadata.genre,
    picture:
      providerMetadata.picture.length > 0 ? providerMetadata.picture : parsedMetadata.picture,
  };
};

const applyPendingMetadataPatch = (
  metadata: AudioMetadata,
  pendingPatch?: DownloadedTrackMetadataPatch,
): AudioMetadata => {
  if (!pendingPatch) return metadata;

  return patchFields.reduce<AudioMetadata>((nextMetadata, field) => {
    if (!hasOwn(pendingPatch, field)) return nextMetadata;

    const value = pendingPatch[field];
    if (value === undefined) return nextMetadata;

    return {
      ...nextMetadata,
      [field]: value,
    };
  }, metadata);
};

const normalizePendingMetadataPatch = (
  pendingPatch?: DownloadedTrackMetadataPatch,
): DownloadedTrackMetadataPatch | undefined => {
  if (!pendingPatch) return undefined;
  if (
    !hasOwn(pendingPatch, "duration") &&
    !hasOwn(pendingPatch, "bitrate") &&
    !hasOwn(pendingPatch, "sampleRate")
  ) {
    return pendingPatch;
  }

  return patchFields.reduce<DownloadedTrackMetadataPatch>((nextPatch, field) => {
    if (!hasOwn(pendingPatch, field)) return nextPatch;
    if (nullableNumericPatchFields.includes(field as (typeof nullableNumericPatchFields)[number])) {
      return nextPatch;
    }

    return {
      ...nextPatch,
      [field]: pendingPatch[field],
    };
  }, {});
};

export function reconcileDownloadedTrackMetadata(
  parsedMetadata: AudioMetadata | undefined,
  providerMetadata?: AudioMetadata,
  pendingPatch?: DownloadedTrackMetadataPatch,
): ReconciledDownloadedTrackMetadata {
  if (!parsedMetadata) {
    return { metadata: providerMetadata };
  }

  const providerDisplayMetadata = applyProviderDisplayMetadata(parsedMetadata, providerMetadata);
  const metadata = applyPendingMetadataPatch(
    providerDisplayMetadata,
    normalizePendingMetadataPatch(pendingPatch),
  );

  return {
    metadata,
    metadataToWrite: areWritableMetadataFieldsEqual(parsedMetadata, metadata)
      ? undefined
      : metadata,
  };
}

export function applyTrackOrderNumbersToFiles(
  files: TagiumFile[],
  albums: AlbumGroup[],
  albumIdsToSync: string[],
) {
  const albumsById = new Map(albums.map((album) => [album.id, album]));
  const numbersByTrackId = new Map<string, number>();

  for (const albumId of albumIdsToSync) {
    const album = albumsById.get(albumId);
    if (!album) continue;
    album.trackIds.forEach((trackId, index) => {
      numbersByTrackId.set(trackId, index + 1);
    });
  }

  if (numbersByTrackId.size === 0) return files;

  return files.map((file) => {
    const trackNumber = numbersByTrackId.get(file.id);
    if (trackNumber === undefined || !file.metadata) return file;

    return markPendingMetadataPatch(
      {
        ...file,
        status: file.status === "saved" ? "pending" : file.status,
        metadata: {
          ...file.metadata,
          trackNumber,
        },
      },
      { trackNumber },
    );
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

    return markPendingMetadataPatch(
      {
        ...file,
        filename: `${syncedFilename}.mp3`,
        status: file.status === "saved" ? "pending" : file.status,
        metadata: {
          ...file.metadata,
          filename: syncedFilename,
        },
      },
      { filename: syncedFilename },
    );
  });
}

export function applyAlbumSharedTagsToFiles(files: TagiumFile[], album: AlbumGroup) {
  if (album.trackIds.length === 0) return files;

  const trackSet = new Set(album.trackIds);

  return files.map((file) => {
    if (!trackSet.has(file.id) || !file.metadata) return file;

    const yearPatch = album.year !== undefined ? { year: album.year } : {};

    return markPendingMetadataPatch(
      {
        ...file,
        status: file.status === "saved" ? "pending" : file.status,
        metadata: {
          ...file.metadata,
          artist: album.artist,
          album: album.title,
          genre: album.genre,
          year: album.year !== undefined ? album.year : file.metadata.year,
        },
      },
      {
        artist: album.artist,
        album: album.title,
        genre: album.genre,
        ...yearPatch,
      },
    );
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

    return markPendingMetadataPatch(
      {
        ...file,
        status: file.status === "saved" ? "pending" : file.status,
        metadata: {
          ...file.metadata,
          picture: cover,
        },
      },
      { picture: cover },
    );
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

export function applyPlaylistImportedCover(
  files: TagiumFile[],
  albums: AlbumGroup[],
  albumId: string,
  trackIds: string[],
  playlist: Pick<Playlist, "isAlbum">,
  settings: { applySoundCloudAlbumCoverToTracks: boolean },
  cover: AudioMetadata["picture"],
  selectedFileId: string | null,
) {
  const coveredAlbums = albums.map((currentAlbum) =>
    currentAlbum.id === albumId ? { ...currentAlbum, cover } : currentAlbum,
  );

  if (!playlist.isAlbum || !settings.applySoundCloudAlbumCoverToTracks) {
    return { albums: coveredAlbums, files };
  }

  return {
    albums: coveredAlbums,
    ...applyAlbumCoverToFilesWithSelectedMetadata(files, trackIds, cover, selectedFileId),
  };
}

export const applySoundCloudSetImportedCover = (
  files: TagiumFile[],
  albums: AlbumGroup[],
  albumId: string,
  trackIds: string[],
  set: Pick<SoundCloudSet, "isAlbum">,
  settings: { applySoundCloudAlbumCoverToTracks: boolean },
  cover: AudioMetadata["picture"],
  selectedFileId: string | null,
) =>
  applyPlaylistImportedCover(
    files,
    albums,
    albumId,
    trackIds,
    set,
    settings,
    cover,
    selectedFileId,
  );

export function prepareDownloadedTrackHydration(
  currentFile: TagiumFile,
  parsedFile: TagiumFile,
  pendingMetadataPatch?: DownloadedTrackMetadataPatch,
): DownloadedTrackHydration {
  const parsedMetadata = parsedFile.metadata;
  const pendingPatch = pendingMetadataPatch ?? currentFile.pendingMetadataPatch;
  const shouldApplyProviderDisplayMetadata =
    currentFile.hasBufferedChanges || Boolean(pendingPatch);
  const { metadata: nextMetadata, metadataToWrite } = reconcileDownloadedTrackMetadata(
    parsedMetadata,
    shouldApplyProviderDisplayMetadata ? currentFile.metadata : undefined,
    pendingPatch,
  );
  const shouldWriteMetadata = Boolean(metadataToWrite);

  const hydratedFile: TagiumFile = {
    ...currentFile,
    file: parsedFile.file,
    originalFile: parsedFile.originalFile,
    filename: nextMetadata?.filename ? `${nextMetadata.filename}.mp3` : parsedFile.filename,
    metadata: nextMetadata,
    downloadStatus: "ready",
    downloadError: parsedFile.downloadError,
    status: shouldWriteMetadata ? "pending" : parsedFile.status,
    hasBufferedChanges: shouldWriteMetadata,
    pendingMetadataPatch: shouldWriteMetadata
      ? normalizePendingMetadataPatch(pendingPatch)
      : undefined,
  };

  return {
    hydratedFile,
    metadataToWrite,
  };
}

export function resolveDownloadedTrackHydrationWrite(
  currentFile: TagiumFile,
  latestFile: TagiumFile,
  _parsedFile: TagiumFile,
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
      originalFile: updatedFile,
      metadata: mergeLatestMetadataWithHydratedTechnicalFields(nextFile, hydratedFile),
      downloadStatus: "ready" as const,
      downloadError: undefined,
      status: "pending" as const,
      hasBufferedChanges: true,
      pendingMetadataPatch:
        nextFile.pendingMetadataPatch ??
        (latestFormMetadata
          ? createMetadataPatch(latestFormMetadata)
          : hydratedFile.pendingMetadataPatch),
    };
  }

  return {
    ...hydratedFile,
    file: updatedFile,
    originalFile: updatedFile,
    filename: updatedFile.name,
    metadata: {
      ...metadataToWrite,
      filename: metadataToWrite.filename,
    },
    status: "saved" as const,
    hasBufferedChanges: false,
    pendingMetadataPatch: undefined,
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
  const metadata = mergeLatestMetadataWithHydratedTechnicalFields(nextFile, hydratedFile);

  return {
    ...nextFile,
    file: parsedFile.file,
    originalFile: parsedFile.originalFile,
    metadata,
    downloadStatus: "ready" as const,
    downloadError: errorMessage,
    status: "error" as const,
    hasBufferedChanges: true,
    pendingMetadataPatch:
      nextFile.pendingMetadataPatch ??
      hydratedFile.pendingMetadataPatch ??
      (metadata ? createMetadataPatch(metadata) : undefined),
  };
}
