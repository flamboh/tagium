import {
  createPlaylistDownloadPlan,
  createQueuedDownloadTracks,
  createSingleUrlDownloadPlan,
  type PlaylistDownloadPlan,
  type SingleUrlDownloadPlan,
} from "@/features/import/downloadTrack";
import type { AudioMetadata } from "@/features/library/types";
import {
  toManifestReplayInput,
  type AlbumManifest,
  type Manifest,
  type ManifestTrack,
  type TrackManifest,
} from "@/features/share/shareManifest";

export type SharedContentDownloadPlan = PlaylistDownloadPlan | SingleUrlDownloadPlan;

const restoreSharedTrack = (
  file: SingleUrlDownloadPlan["pendingFiles"][number],
  track: ManifestTrack,
  sourceManifestSlug: string,
  hasSharedArtwork: boolean,
  cover?: AudioMetadata["picture"],
) => {
  const metadata = track.metadata;
  const picture = hasSharedArtwork && cover?.length ? cover : [];
  const downloadRequest: SingleUrlDownloadPlan["pendingFiles"][number]["downloadRequest"] = {
    sourceUrl: track.sourceUrl,
    audioBitrate: track.audioBitrate,
    audioFormat: "mp3",
  };
  if (metadata.year !== undefined) downloadRequest.year = metadata.year;
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
    downloadRequest,
    pendingMetadataPatch: {
      ...metadata,
      picture,
    },
    hasBufferedChanges: true,
    sourceManifestSlug,
  };
};

/**
 * Enters the existing playlist planner while restoring fields a provider-shaped
 * playlist cannot express, such as per-track filenames, tags, and bitrates.
 */
export const createSharedAlbumDownloadPlan = (
  manifest: AlbumManifest,
  sourceManifestSlug: string,
  createId: () => string,
  cover?: AudioMetadata["picture"],
): PlaylistDownloadPlan => {
  const replay = toManifestReplayInput(manifest, { sourceManifestSlug });
  const plan = createPlaylistDownloadPlan({
    playlist: replay.playlist,
    audioBitrate: replay.tracks[0]!.audioBitrate,
    audioFormat: "mp3",
    createId,
  });
  const pendingFiles = plan.pendingFiles.map((file, index) => {
    const track = replay.tracks[index]!;
    return restoreSharedTrack(
      file,
      track,
      sourceManifestSlug,
      Boolean(manifest.album.artwork),
      cover,
    );
  });
  const album = {
    ...plan.album,
    title: manifest.album.title,
    artist: manifest.album.artist,
    genre: manifest.album.genre,
    sourceManifestSlug,
  };
  if (manifest.album.year !== undefined) album.year = manifest.album.year;
  if (manifest.album.sourceUrl !== undefined) album.sourceUrl = manifest.album.sourceUrl;
  if (cover?.length) album.cover = cover;

  return {
    ...plan,
    pendingFiles,
    queuedTracks: pendingFiles.map((file) => ({
      fileId: file.id,
      title: file.metadata.title || file.filename.replace(/\.mp3$/i, ""),
      downloadRequest: file.downloadRequest,
    })),
    album,
  };
};

/**
 * Enters the existing single-URL planner while restoring every field carried by
 * the shared track manifest and retaining file-level share provenance.
 */
export const createSharedTrackDownloadPlan = (
  manifest: TrackManifest,
  sourceManifestSlug: string,
  createId: () => string,
  cover?: AudioMetadata["picture"],
): SingleUrlDownloadPlan => {
  const plan = createSingleUrlDownloadPlan({
    sourceUrl: manifest.track.sourceUrl,
    audioBitrate: manifest.track.audioBitrate,
    audioFormat: "mp3",
    createId,
  });
  const pendingFiles = plan.pendingFiles.map((file) =>
    restoreSharedTrack(
      file,
      manifest.track,
      sourceManifestSlug,
      Boolean(manifest.track.artwork),
      cover,
    ),
  );

  return {
    ...plan,
    pendingFiles,
    queuedTracks: createQueuedDownloadTracks(pendingFiles),
  };
};

export const createSharedContentDownloadPlan = (
  manifest: Manifest,
  sourceManifestSlug: string,
  createId: () => string,
  cover?: AudioMetadata["picture"],
): SharedContentDownloadPlan =>
  manifest.kind === "album"
    ? createSharedAlbumDownloadPlan(manifest, sourceManifestSlug, createId, cover)
    : createSharedTrackDownloadPlan(manifest, sourceManifestSlug, createId, cover);
