import { UploadedTrack } from "./mp3Utils";
import { AlbumGroup, AudioMetadata } from "./types";

export interface AlbumMetadataInput {
  title: string;
  artist: string;
  genre: string;
  cover?: AudioMetadata["picture"];
  syncTrackNumbers: boolean;
}

interface MergeUploadedTracksOptions {
  forceSingleAlbum?: boolean;
}

export type SidebarDropTarget =
  | { type: "album"; albumId: string; placement: "append" }
  | {
      type: "album";
      albumId: string;
      placement: "before" | "after";
      referenceTrackId: string;
    }
  | { type: "loose"; placement: "append" }
  | { type: "loose"; placement: "before" | "after"; referenceTrackId: string };

const buildAlbumKey = (title: string, artist: string) =>
  `${title.trim().toLowerCase()}::${artist.trim().toLowerCase()}`;

const cloneAlbum = (album: AlbumGroup) => ({
  ...album,
  trackIds: [...album.trackIds],
});

export const pruneEmptyAlbums = (albums: AlbumGroup[]) =>
  albums;

export function mergeUploadedTracksIntoAlbums(
  prevAlbums: AlbumGroup[],
  parsedUploads: UploadedTrack[],
  options: MergeUploadedTracksOptions = {}
) {
  const nextAlbums = pruneEmptyAlbums(prevAlbums.map(cloneAlbum));
  const forceSingleAlbum = options.forceSingleAlbum ?? false;

  if (forceSingleAlbum && parsedUploads.length > 0) {
    const firstSeed = parsedUploads[0].albumSeed;
    const albumTitle = firstSeed.title || `Album ${nextAlbums.length + 1}`;

    const createdAlbum: AlbumGroup = {
      id: crypto.randomUUID(),
      title: albumTitle,
      artist: firstSeed.artist,
      genre: firstSeed.genre,
      cover: firstSeed.cover,
      trackIds: parsedUploads.map((upload) => upload.file.id),
      syncTrackNumbers: false,
    };

    if (!createdAlbum.artist) {
      const nextArtist = parsedUploads
        .map((upload) => upload.albumSeed.artist)
        .find((artist) => Boolean(artist));
      createdAlbum.artist = nextArtist || "";
    }
    if (!createdAlbum.genre) {
      const nextGenre = parsedUploads
        .map((upload) => upload.albumSeed.genre)
        .find((genre) => Boolean(genre));
      createdAlbum.genre = nextGenre || "";
    }
    if (!createdAlbum.cover || createdAlbum.cover.length === 0) {
      const nextCover = parsedUploads
        .map((upload) => upload.albumSeed.cover)
        .find((cover) => cover && cover.length > 0);
      createdAlbum.cover = nextCover;
    }

    nextAlbums.push(createdAlbum);
    return {
      albums: nextAlbums,
      firstSelectedAlbumId: createdAlbum.id,
      unassignedTrackIds: [] as string[],
    };
  }

  const albumByKey = new Map(
    nextAlbums.map((album) => [buildAlbumKey(album.title, album.artist), album])
  );
  let firstSelectedAlbumId: string | null = null;
  const unassignedTrackIds: string[] = [];

  parsedUploads.forEach((upload, index) => {
    const { albumSeed } = upload;

    if (!albumSeed.title.trim()) {
      unassignedTrackIds.push(upload.file.id);
      return;
    }

    const key = buildAlbumKey(albumSeed.title, albumSeed.artist);
    let targetAlbum = albumByKey.get(key);

    if (!targetAlbum) {
      targetAlbum = {
        id: crypto.randomUUID(),
        title: albumSeed.title,
        artist: albumSeed.artist,
        genre: albumSeed.genre,
        cover: albumSeed.cover,
        trackIds: [],
        syncTrackNumbers: false,
      };
      nextAlbums.push(targetAlbum);
      albumByKey.set(key, targetAlbum);
    }

    if (!targetAlbum.artist && albumSeed.artist) targetAlbum.artist = albumSeed.artist;
    if (!targetAlbum.genre && albumSeed.genre) targetAlbum.genre = albumSeed.genre;
    if ((!targetAlbum.cover || targetAlbum.cover.length === 0) && albumSeed.cover) {
      targetAlbum.cover = albumSeed.cover;
    }

    targetAlbum.trackIds.push(upload.file.id);
    if (index === 0 || !firstSelectedAlbumId) {
      firstSelectedAlbumId = targetAlbum.id;
    }
  });

  return {
    albums: nextAlbums,
    firstSelectedAlbumId,
    unassignedTrackIds,
  };
}

export function removeTrackFromAlbums(prevAlbums: AlbumGroup[], trackId: string) {
  return pruneEmptyAlbums(
    prevAlbums.map((album) => ({
      ...album,
      trackIds: album.trackIds.filter((id) => id !== trackId),
    }))
  );
}

export function moveTrackInSidebar(
  prevAlbums: AlbumGroup[],
  prevLooseTrackIds: string[],
  trackId: string,
  target: SidebarDropTarget
) {
  const albums = prevAlbums.map(cloneAlbum);
  const looseTrackIds = [...prevLooseTrackIds];

  const sourceAlbum = albums.find((album) => album.trackIds.includes(trackId));
  const sourceAlbumId = sourceAlbum?.id ?? null;
  const sourceLooseIndex = looseTrackIds.indexOf(trackId);

  if (sourceAlbum) {
    sourceAlbum.trackIds = sourceAlbum.trackIds.filter((id) => id !== trackId);
  }
  if (sourceLooseIndex >= 0) {
    looseTrackIds.splice(sourceLooseIndex, 1);
  }

  const resolveInsertIndex = (
    trackIds: string[],
    placement: "append" | "before" | "after",
    referenceTrackId?: string
  ) => {
    if (placement === "append") {
      return trackIds.length;
    }
    if (!referenceTrackId) {
      return trackIds.length;
    }
    const referenceIndex = trackIds.indexOf(referenceTrackId);
    if (referenceIndex < 0) {
      return trackIds.length;
    }
    return placement === "before" ? referenceIndex : referenceIndex + 1;
  };

  if (target.type === "album") {
    const targetAlbum = albums.find((album) => album.id === target.albumId);
    if (!targetAlbum) {
      return {
        albums: pruneEmptyAlbums(albums),
        looseTrackIds,
        albumsToSync: [] as string[],
      };
    }
    if (target.placement !== "append" && target.referenceTrackId === trackId) {
      return {
        albums: pruneEmptyAlbums(albums),
        looseTrackIds,
        albumsToSync: [] as string[],
      };
    }
    const insertIndex = resolveInsertIndex(
      targetAlbum.trackIds,
      target.placement,
      target.placement === "append" ? undefined : target.referenceTrackId
    );
    targetAlbum.trackIds.splice(insertIndex, 0, trackId);
  } else {
    if (target.placement !== "append" && target.referenceTrackId === trackId) {
      return {
        albums: pruneEmptyAlbums(albums),
        looseTrackIds,
        albumsToSync: [] as string[],
      };
    }
    const insertIndex = resolveInsertIndex(
      looseTrackIds,
      target.placement,
      target.placement === "append" ? undefined : target.referenceTrackId
    );
    looseTrackIds.splice(insertIndex, 0, trackId);
  }

  const prunedAlbums = pruneEmptyAlbums(albums);
  const albumIdsToCheck = [sourceAlbumId, target.type === "album" ? target.albumId : null]
    .filter((id): id is string => Boolean(id))
    .filter((id, index, list) => list.indexOf(id) === index);

  const albumsToSync = albumIdsToCheck.filter((albumId) => {
    const album = prunedAlbums.find((entry) => entry.id === albumId);
    return Boolean(album?.syncTrackNumbers);
  });

  return {
    albums: prunedAlbums,
    looseTrackIds,
    albumsToSync,
  };
}

export function updateAlbumMetadata(
  prevAlbums: AlbumGroup[],
  albumId: string,
  metadata: AlbumMetadataInput
) {
  return prevAlbums.map((album) =>
    album.id === albumId
      ? {
          ...album,
          title: metadata.title,
          artist: metadata.artist,
          genre: metadata.genre,
          cover: metadata.cover,
          syncTrackNumbers: metadata.syncTrackNumbers,
        }
      : album
  );
}

export function createAlbumFromTracks(
  prevAlbums: AlbumGroup[],
  prevLooseTrackIds: string[],
  trackIds: string[],
  metadata: AlbumMetadataInput
) {
  const uniqueTrackIds = [...new Set(trackIds)];
  const albums = prevAlbums.map(cloneAlbum);
  let looseTrackIds = [...prevLooseTrackIds];
  const sourceAlbumIds: string[] = [];

  for (const trackId of uniqueTrackIds) {
    const sourceAlbum = albums.find((album) => album.trackIds.includes(trackId));
    if (sourceAlbum) {
      sourceAlbum.trackIds = sourceAlbum.trackIds.filter((id) => id !== trackId);
      sourceAlbumIds.push(sourceAlbum.id);
    }
    looseTrackIds = looseTrackIds.filter((id) => id !== trackId);
  }

  const newAlbumId = crypto.randomUUID();
  const createdAlbum: AlbumGroup = {
    id: newAlbumId,
    title: metadata.title,
    artist: metadata.artist,
    genre: metadata.genre,
    cover: metadata.cover,
    syncTrackNumbers: metadata.syncTrackNumbers,
    trackIds: uniqueTrackIds,
  };

  const mergedAlbums = [...albums, createdAlbum];
  const syncAlbums = [...new Set(sourceAlbumIds)]
    .filter((albumId) => {
      const album = albums.find((entry) => entry.id === albumId);
      return Boolean(album?.syncTrackNumbers);
    });

  if (createdAlbum.syncTrackNumbers) {
    syncAlbums.push(newAlbumId);
  }

  return {
    albums: mergedAlbums,
    looseTrackIds,
    newAlbumId,
    syncAlbums: [...new Set(syncAlbums)],
  };
}

export function reorderAlbums(
  prevAlbums: AlbumGroup[],
  albumId: string,
  targetIndex: number
) {
  const albums = [...prevAlbums];
  const sourceIndex = albums.findIndex((album) => album.id === albumId);
  if (sourceIndex < 0 || sourceIndex === targetIndex) {
    return albums;
  }
  const [movedAlbum] = albums.splice(sourceIndex, 1);
  albums.splice(targetIndex, 0, movedAlbum);
  return albums;
}
