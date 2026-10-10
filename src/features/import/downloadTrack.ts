import {
  coverArtFileToPicture,
  MAX_COVER_ART_UPLOAD_BYTES,
  normalizeCoverArtType,
  optimizeCoverArt,
} from "@/features/editor/coverArtProcessing";
import {
  createDownloadMetadata,
  createPlaylistPendingMetadataPatch,
  createPlaylistTrackMetadata,
  getPlaylistTrackPendingYear,
} from "@/features/import/downloadMetadata";
import type { Playlist } from "@/features/import/playlist";
import type { TrackMetadata } from "@/features/import/trackMetadata";
import type {
  AlbumGroup,
  AppSettings,
  AudioMetadata,
  MetadataPatch,
  TagiumFile,
} from "@/features/library/types";

export type DownloadRequest = NonNullable<TagiumFile["downloadRequest"]>;

export interface PendingDownloadTrack extends TagiumFile {
  metadata: AudioMetadata;
  downloadRequest: DownloadRequest;
}

export interface QueuedDownloadTrack {
  fileId: string;
  title: string;
  downloadRequest: DownloadRequest;
}

export interface DownloadPlanSelection {
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
  lastSelectedFileId: string | null;
}

interface DownloadTrackPlanBase {
  pendingFiles: PendingDownloadTrack[];
  queuedTracks: QueuedDownloadTrack[];
  selection: DownloadPlanSelection;
}

export interface SingleUrlDownloadPlan extends DownloadTrackPlanBase {
  source: "single-url";
  looseTrackIds: string[];
}

export interface PlaylistCoverImportPlan {
  albumId: string;
  trackIds: string[];
  coverUrl: string;
  playlist: Playlist;
}

export interface PlaylistDownloadPlan extends DownloadTrackPlanBase {
  source: "playlist";
  album: AlbumGroup;
  coverImport: PlaylistCoverImportPlan | null;
}

export interface CreateSingleUrlDownloadPlanInput {
  sourceUrl: string;
  audioBitrate: AppSettings["audioBitrate"];
  audioFormat: AppSettings["audioFormat"];
  createId: () => string;
  importId?: string;
  metadata?: TrackMetadata;
}

export interface CreatePlaylistDownloadPlanInput {
  playlist: Playlist;
  audioBitrate: AppSettings["audioBitrate"];
  audioFormat: AppSettings["audioFormat"];
  createId: () => string;
  importId?: string;
}

export const titleFromSourceUrl = (sourceUrl: string) => {
  try {
    const url = new URL(sourceUrl);
    const [lastPathPart] = url.pathname.split("/").filter(Boolean).slice(-1);
    if (lastPathPart) return decodeURIComponent(lastPathPart).replaceAll("-", " ");
    return url.hostname;
  } catch {
    return "downloading audio";
  }
};

export const createPendingDownloadTrack = (
  id: string,
  metadata: AudioMetadata,
  hasBufferedChanges: boolean,
  downloadRequest: DownloadRequest,
  pendingMetadataPatch?: MetadataPatch,
): PendingDownloadTrack => ({
  id,
  filename: `${metadata.filename}.mp3`,
  status: "pending",
  downloadStatus: "downloading",
  downloadRequest,
  hasBufferedChanges,
  pendingMetadataPatch,
  metadata,
});

interface FetchImportedCoverDependencies {
  fetch?: typeof globalThis.fetch;
  optimize?: (file: File) => Promise<File>;
}

const readCoverResponseFile = async (response: Response, contentType: string) => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COVER_ART_UPLOAD_BYTES) {
    throw new Error("cover art must be 25 mb or smaller.");
  }
  if (!response.body) throw new Error("album cover response body is unavailable.");

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const reader = response.body.getReader();
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_COVER_ART_UPLOAD_BYTES) {
        await reader.cancel();
        throw new Error("cover art must be 25 mb or smaller.");
      }
      chunks.push(Uint8Array.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  const extension = contentType === "image/png" ? "png" : "jpg";
  return new File(chunks, `imported-cover.${extension}`, { type: contentType });
};

export const fetchImportedCover = async (
  coverUrl: string,
  dependencies: FetchImportedCoverDependencies = {},
): Promise<AudioMetadata["picture"]> => {
  const response = await (dependencies.fetch ?? globalThis.fetch)(coverUrl);

  if (!response.ok) {
    throw new Error(`album cover request failed (${response.status})`);
  }

  const contentTypeHeader = response.headers.get("content-type");
  if (!contentTypeHeader) {
    throw new Error("album cover response missing content type.");
  }
  const contentType = normalizeCoverArtType(contentTypeHeader);
  const coverFile = await readCoverResponseFile(response, contentType);
  const optimizedCover = await (dependencies.optimize ?? optimizeCoverArt)(coverFile);
  return coverArtFileToPicture(optimizedCover, "album cover");
};

export const createQueuedDownloadTrack = (file: PendingDownloadTrack): QueuedDownloadTrack => ({
  fileId: file.id,
  title: file.metadata.title || file.filename.replace(/\.mp3$/i, "") || "downloading audio",
  downloadRequest: file.downloadRequest,
});

export const createQueuedDownloadTracks = (
  files: readonly PendingDownloadTrack[],
): QueuedDownloadTrack[] => files.map(createQueuedDownloadTrack);

export const createSingleUrlDownloadPlan = ({
  sourceUrl,
  audioBitrate,
  audioFormat,
  createId,
  importId,
  metadata,
}: CreateSingleUrlDownloadPlanInput): SingleUrlDownloadPlan => {
  const id = createId();
  const title = metadata?.title || titleFromSourceUrl(sourceUrl);
  const downloadRequest: DownloadRequest = { sourceUrl, audioBitrate, audioFormat };
  if (importId) downloadRequest.importId = importId;
  const pendingFile = createPendingDownloadTrack(
    id,
    createDownloadMetadata({
      title,
      artist: metadata?.artist ?? "",
      album: "",
      genre: "",
    }),
    false,
    downloadRequest,
  );

  return {
    source: "single-url",
    pendingFiles: [pendingFile],
    queuedTracks: createQueuedDownloadTracks([pendingFile]),
    selection: {
      selectedAlbumId: null,
      selectedFileId: id,
      selectedFileIds: new Set([id]),
      lastSelectedFileId: id,
    },
    looseTrackIds: [id],
  };
};

export const createPlaylistDownloadPlan = ({
  playlist,
  audioBitrate,
  audioFormat,
  createId,
  importId,
}: CreatePlaylistDownloadPlanInput): PlaylistDownloadPlan => {
  const albumId = createId();
  const pendingFiles = playlist.tracks.map((track) => {
    const downloadRequest: DownloadRequest = {
      sourceUrl: track.url,
      audioBitrate,
      audioFormat,
      trackIndex: track.trackNumber,
    };
    if (importId) downloadRequest.importId = importId;
    const year = getPlaylistTrackPendingYear(playlist, track);
    if (year !== undefined) downloadRequest.year = year;
    else if (playlist.year !== undefined) downloadRequest.fallbackYear = playlist.year;
    return createPendingDownloadTrack(
      createId(),
      createPlaylistTrackMetadata(playlist, track),
      true,
      downloadRequest,
      createPlaylistPendingMetadataPatch(playlist, track),
    );
  });
  const album: AlbumGroup = {
    id: albumId,
    title: playlist.title,
    artist: playlist.artist,
    genre: playlist.genre,
    trackIds: pendingFiles.map((file) => file.id),
    year: playlist.year,
  };
  if (playlist.tracks.some((track) => track.artist !== undefined)) {
    album.metadataLinks = { artist: false, year: false };
  }
  if (playlist.sourceUrl !== undefined) album.sourceUrl = playlist.sourceUrl;
  if (playlist.coverUrl) album.coverPending = true;
  const firstPendingFileId = pendingFiles[0]?.id ?? null;

  return {
    source: "playlist",
    pendingFiles,
    queuedTracks: createQueuedDownloadTracks(pendingFiles),
    selection: {
      selectedAlbumId: albumId,
      selectedFileId: firstPendingFileId,
      selectedFileIds: new Set(firstPendingFileId ? [firstPendingFileId] : []),
      lastSelectedFileId: firstPendingFileId,
    },
    album,
    coverImport: playlist.coverUrl
      ? {
          albumId,
          trackIds: album.trackIds,
          coverUrl: playlist.coverUrl,
          playlist,
        }
      : null,
  };
};
