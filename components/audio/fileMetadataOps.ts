import { AlbumGroup, TagiumFile } from "./types";

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

    return {
      ...file,
      status: file.status === "saved" ? "pending" : file.status,
      metadata: {
        ...file.metadata,
        artist: album.artist,
        album: album.title,
        genre: album.genre,
        picture: album.cover && album.cover.length > 0 ? album.cover : file.metadata.picture,
        trackNumber: album.syncTrackNumbers ? trackIndex.get(file.id) : file.metadata.trackNumber,
      },
    };
  });
}
