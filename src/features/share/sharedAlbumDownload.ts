import {
  createPlaylistDownloadPlan,
  type PlaylistDownloadPlan,
} from "@/features/import/downloadTrack";
import type { AudioMetadata } from "@/features/library/types";
import { toManifestReplayInput, type Manifest } from "@/features/share/shareManifest";

/**
 * Enters the existing playlist planner while restoring fields a provider-shaped
 * playlist cannot express, such as per-track filenames, tags, and bitrates.
 */
export const createSharedAlbumDownloadPlan = (
  manifest: Manifest,
  sourceManifestSlug: string,
  createId: () => string,
  cover?: AudioMetadata["picture"],
): PlaylistDownloadPlan => {
  const replay = toManifestReplayInput(manifest, { sourceManifestSlug });
  const plan = createPlaylistDownloadPlan({
    playlist: replay.playlist,
    audioBitrate: replay.tracks[0]!.audioBitrate,
    createId,
  });
  const pendingFiles = plan.pendingFiles.map((file, index) => {
    const track = replay.tracks[index]!;
    const metadata = track.metadata;
    const picture = cover?.length ? cover : file.metadata.picture;
    return {
      ...file,
      filename: `${metadata.filename}.mp3`,
      metadata: {
        ...file.metadata,
        ...metadata,
        year: metadata.year ?? null,
        trackNumber: metadata.trackNumber ?? null,
        picture,
      },
      downloadRequest: {
        sourceUrl: track.sourceUrl,
        audioBitrate: track.audioBitrate,
        ...(metadata.year === undefined ? {} : { year: metadata.year }),
      },
      pendingMetadataPatch: {
        ...metadata,
        ...(cover?.length ? { picture: cover } : {}),
      },
      hasBufferedChanges: true,
    };
  });

  return {
    ...plan,
    pendingFiles,
    queuedTracks: pendingFiles.map((file) => ({
      fileId: file.id,
      title: file.metadata.title || file.filename.replace(/\.mp3$/i, ""),
      downloadRequest: file.downloadRequest,
    })),
    album: {
      ...plan.album,
      title: manifest.album.title,
      artist: manifest.album.artist,
      genre: manifest.album.genre,
      ...(manifest.album.year === undefined ? {} : { year: manifest.album.year }),
      ...(manifest.album.sourceUrl === undefined ? {} : { sourceUrl: manifest.album.sourceUrl }),
      ...(cover?.length ? { cover } : {}),
      sourceManifestSlug,
    },
  };
};
