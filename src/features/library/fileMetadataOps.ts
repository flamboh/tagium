import filenamify from "filenamify";
import { audioFilename, getAudioFormat } from "@/features/audio/audioFormat";
import {
  EDITABLE_METADATA_FIELDS,
  NULLABLE_NUMERIC_METADATA_FIELDS,
  validateAdvancedMetadataNumber,
} from "@/features/audio/metadataFields";
import type { Playlist } from "@/features/import/playlist";
import type { SoundCloudSet } from "@/features/import/soundcloudSet";
import type {
  AlbumGroup,
  AppSettings,
  AudioMetadata,
  MetadataPatch,
  TagiumFile,
} from "@/features/library/types";

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

const patchFields =
  EDITABLE_METADATA_FIELDS satisfies readonly DownloadedTrackWritableMetadataField[];

const nullableNumericPatchFields = NULLABLE_NUMERIC_METADATA_FIELDS;

const hasOwn = <Key extends PropertyKey>(object: object, key: Key) =>
  Object.prototype.hasOwnProperty.call(object, key);

export const sanitizePendingMetadataPatch = (
  patch: DownloadedTrackMetadataPatch,
  dropLegacyNumericFields = false,
): DownloadedTrackMetadataPatch | undefined => {
  const sanitized = patchFields.reduce<DownloadedTrackMetadataPatch>((nextPatch, field) => {
    if (!hasOwn(patch, field) || patch[field] === undefined) return nextPatch;
    if (
      (field === "discNumber" || field === "bpm") &&
      validateAdvancedMetadataNumber(field, patch[field] as number | null | undefined)
    ) {
      return nextPatch;
    }
    if (
      dropLegacyNumericFields &&
      nullableNumericPatchFields.includes(field as (typeof nullableNumericPatchFields)[number])
    ) {
      return nextPatch;
    }
    return { ...nextPatch, [field]: patch[field] };
  }, {});
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
};

const markPendingMetadataPatch = (
  file: TagiumFile,
  patch: DownloadedTrackMetadataPatch,
): TagiumFile => {
  const pendingMetadataPatch = sanitizePendingMetadataPatch({
    ...file.pendingMetadataPatch,
    ...patch,
  });

  return {
    ...file,
    pendingMetadataPatch,
    hasBufferedChanges: Boolean(pendingMetadataPatch),
  };
};

const createMetadataPatch = (metadata: AudioMetadata): DownloadedTrackMetadataPatch => ({
  filename: metadata.filename,
  title: metadata.title,
  artist: metadata.artist,
  albumArtist: metadata.albumArtist,
  album: metadata.album,
  year: metadata.year,
  genre: metadata.genre,
  picture: metadata.picture,
  trackNumber: metadata.trackNumber,
  discNumber: metadata.discNumber,
  composer: metadata.composer,
  bpm: metadata.bpm,
  comment: metadata.comment,
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
  firstMetadata.albumArtist === secondMetadata.albumArtist &&
  firstMetadata.album === secondMetadata.album &&
  firstMetadata.year === secondMetadata.year &&
  areGenresEqual(firstMetadata.genre, secondMetadata.genre) &&
  arePicturesEqual(firstMetadata.picture, secondMetadata.picture) &&
  firstMetadata.trackNumber === secondMetadata.trackNumber &&
  firstMetadata.discNumber === secondMetadata.discNumber &&
  firstMetadata.composer === secondMetadata.composer &&
  firstMetadata.bpm === secondMetadata.bpm &&
  firstMetadata.comment === secondMetadata.comment;

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
  const hasNoLegacyTechnicalFields =
    !hasOwn(pendingPatch, "duration") &&
    !hasOwn(pendingPatch, "bitrate") &&
    !hasOwn(pendingPatch, "sampleRate");
  return sanitizePendingMetadataPatch(pendingPatch, !hasNoLegacyTechnicalFields);
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
  settings: MetadataPolicySettings = defaultMetadataPolicySettings,
) {
  const albumIds = new Set(albumIdsToSync);
  const trackUpdates = new Map<string, { album: AlbumGroup; trackNumber: number }>();
  for (const album of albums) {
    if (!albumIds.has(album.id)) continue;
    album.trackIds.forEach((trackId, index) => {
      trackUpdates.set(trackId, { album, trackNumber: index + 1 });
    });
  }

  return files.map((file) => {
    const update = trackUpdates.get(file.id);
    if (!update || !file.metadata || !settings.syncTrackNumbers) return file;
    const patch: MetadataPatch = { trackNumber: update.trackNumber };
    return markPendingMetadataPatch(
      {
        ...file,
        status: file.status === "saved" ? "pending" : file.status,
        metadata: { ...file.metadata, ...patch },
      },
      patch,
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
    const nextFilename = audioFilename(syncedFilename, getAudioFormat(file));
    if (file.filename === nextFilename && file.metadata.filename === syncedFilename) {
      return file;
    }

    return markPendingMetadataPatch(
      {
        ...file,
        filename: nextFilename,
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

export type MetadataPolicySettings = Pick<AppSettings, "metadataLinks" | "syncTrackNumbers">;

const defaultMetadataPolicySettings: MetadataPolicySettings = {
  syncTrackNumbers: true,
  metadataLinks: {
    artist: true,
    year: true,
    genre: true,
    artwork: true,
    albumArtist: true,
  },
};

export interface AlbumMetadataPolicyOptions {
  shared?: boolean;
  artwork?: boolean;
  trackNumbers?: boolean;
}

/** Applies album-to-track synchronization as one sparse, non-destructive policy. */
export function applyAlbumMetadataPolicyToFiles(
  files: TagiumFile[],
  album: AlbumGroup,
  settings: MetadataPolicySettings = defaultMetadataPolicySettings,
  options: AlbumMetadataPolicyOptions = {},
) {
  if (album.trackIds.length === 0) return files;

  const trackSet = new Set(album.trackIds);
  const trackNumbers = options.trackNumbers
    ? new Map(album.trackIds.map((trackId, index) => [trackId, index + 1]))
    : undefined;
  const shared = options.shared ?? true;

  return files.map((file) => {
    if (!trackSet.has(file.id) || !file.metadata) return file;

    const patch: MetadataPatch = {};
    if (shared) {
      patch.album = album.title;
      if (settings.metadataLinks.artist) patch.artist = album.artist;
      if (settings.metadataLinks.genre) patch.genre = album.genre;
      if (settings.metadataLinks.year && album.year !== undefined) patch.year = album.year;
    }
    if (options.artwork && settings.metadataLinks.artwork && album.cover?.length) {
      patch.picture = album.cover;
    }
    if (options.trackNumbers && settings.syncTrackNumbers) {
      const trackNumber = trackNumbers?.get(file.id);
      if (trackNumber !== undefined) patch.trackNumber = trackNumber;
    }

    const linkedArtist = patch.artist ?? file.metadata.artist;
    if (shared && settings.metadataLinks.albumArtist) {
      patch.albumArtist = linkedArtist;
    }

    if (Object.keys(patch).length === 0) return file;
    return markPendingMetadataPatch(
      {
        ...file,
        status: file.status === "saved" ? "pending" : file.status,
        metadata: { ...file.metadata, ...patch },
      },
      patch,
    );
  });
}

export function applyAlbumSharedTagsToFiles(
  files: TagiumFile[],
  album: AlbumGroup,
  settings?: MetadataPolicySettings,
) {
  return applyAlbumMetadataPolicyToFiles(files, album, settings);
}

export function applyAlbumCoverToFiles(
  files: TagiumFile[],
  trackIds: string[],
  cover: AudioMetadata["picture"],
  settings?: MetadataPolicySettings,
) {
  if (trackIds.length === 0 || cover.length === 0) return files;
  return applyAlbumMetadataPolicyToFiles(
    files,
    { id: "cover-sync", title: "", artist: "", genre: "", trackIds, cover },
    settings,
    { shared: false, artwork: true },
  );
}

export function applyAlbumCoverToFilesWithSelectedMetadata(
  files: TagiumFile[],
  trackIds: string[],
  cover: AudioMetadata["picture"],
  selectedFileId: string | null,
  settings?: MetadataPolicySettings,
): { files: TagiumFile[]; selectedMetadata?: AudioMetadata } {
  const coveredFiles = applyAlbumCoverToFiles(files, trackIds, cover, settings);
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
  settings: Pick<
    AppSettings,
    "applySoundCloudAlbumCoverToTracks" | "metadataLinks" | "syncTrackNumbers"
  >,
  cover: AudioMetadata["picture"],
  selectedFileId: string | null,
) {
  const coveredAlbums = albums.map((currentAlbum) =>
    currentAlbum.id === albumId ? { ...currentAlbum, cover } : currentAlbum,
  );

  if (
    !playlist.isAlbum ||
    !settings.applySoundCloudAlbumCoverToTracks ||
    !settings.metadataLinks.artwork
  ) {
    return { albums: coveredAlbums, files };
  }

  return {
    albums: coveredAlbums,
    ...applyAlbumCoverToFilesWithSelectedMetadata(files, trackIds, cover, selectedFileId, settings),
  };
}

export const applySoundCloudSetImportedCover = (
  files: TagiumFile[],
  albums: AlbumGroup[],
  albumId: string,
  trackIds: string[],
  set: Pick<SoundCloudSet, "isAlbum">,
  settings: Pick<
    AppSettings,
    "applySoundCloudAlbumCoverToTracks" | "metadataLinks" | "syncTrackNumbers"
  >,
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
    format: parsedFile.format,
    filename: nextMetadata?.filename
      ? audioFilename(nextMetadata.filename, getAudioFormat(parsedFile))
      : parsedFile.filename,
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
          filename: audioFilename(latestFormMetadata.filename, getAudioFormat(latestFile)),
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
