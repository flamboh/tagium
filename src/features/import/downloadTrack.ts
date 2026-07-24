import filenamify from "filenamify";
import {
  coverArtFileToPicture,
  MAX_COVER_ART_UPLOAD_BYTES,
  normalizeCoverArtType,
  optimizeCoverArt,
} from "@/features/editor/coverArtProcessing";
import type { Playlist } from "@/features/import/playlist";
import type { SoundCloudSet } from "@/features/import/soundcloudSet";
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

export type SoundCloudSetCoverImportPlan = PlaylistCoverImportPlan;
export type SoundCloudSetDownloadPlan = PlaylistDownloadPlan;
export type DownloadTrackPlan = SingleUrlDownloadPlan | PlaylistDownloadPlan;

export interface CreateSingleUrlDownloadPlanInput {
  sourceUrl: string;
  audioBitrate: AppSettings["audioBitrate"];
  createId: () => string;
  importId?: string;
  metadata?: TrackMetadata;
}

export interface CreateSoundCloudSetDownloadPlanInput {
  set: SoundCloudSet;
  audioBitrate: AppSettings["audioBitrate"];
  createId: () => string;
}

export interface CreatePlaylistDownloadPlanInput {
  playlist: Playlist;
  audioBitrate: AppSettings["audioBitrate"];
  createId: () => string;
  importId?: string;
}

export interface DownloadTrackWorkflowDeps {
  bufferCurrentFormMetadata: () => void;
  setActiveView: (view: "editor") => void;
  getFiles: () => TagiumFile[];
  setFiles: (files: TagiumFile[]) => void;
  setSelectedAlbumId: (albumId: string | null) => void;
  setSelectedFileId: (fileId: string | null) => void;
  setSelectedFileIds: (fileIds: Set<string>) => void;
  setLastSelectedFileId: (fileId: string | null) => void;
  queueDownloadTracks: (tracks: QueuedDownloadTrack[]) => void;
  addLooseTrackIds?: (trackIds: string[]) => void;
}

export type SingleUrlDownloadTrackWorkflowDeps = DownloadTrackWorkflowDeps;

export interface PlaylistDownloadWorkflowDeps extends DownloadTrackWorkflowDeps {
  getAlbums: () => AlbumGroup[];
  setAlbums: (albums: AlbumGroup[]) => void;
}

export type SoundCloudSetDownloadWorkflowDeps = PlaylistDownloadWorkflowDeps;

const filenameFromTitle = (title: string) => {
  const filename = filenamify(title.trim(), { replacement: "-" });
  if (filename) return `${filename}.mp3`;
  return "downloading-track.mp3";
};

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

export const createDownloadMetadata = ({
  title,
  artist,
  album,
  genre,
  year,
  duration,
  trackNumber,
}: {
  title: string;
  artist: string;
  album: string;
  genre: string;
  year?: number;
  duration?: number;
  trackNumber?: number;
}): AudioMetadata => ({
  filename: filenameFromTitle(title).replace(/\.mp3$/i, ""),
  title,
  artist,
  album,
  genre,
  duration: duration ?? 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  year: year ?? null,
  trackNumber: trackNumber ?? null,
});

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
    throw new Error("cover art must be 25 MB or smaller.");
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
        throw new Error("cover art must be 25 MB or smaller.");
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

const createPlaylistPendingMetadataPatch = (
  playlist: Playlist,
  track: Playlist["tracks"][number],
): MetadataPatch => ({
  title: track.title,
  artist: playlist.artist,
  album: playlist.title,
  genre: playlist.genre,
  ...(playlist.year !== undefined ? { year: playlist.year } : {}),
  ...(track.trackNumber !== undefined ? { trackNumber: track.trackNumber } : {}),
});

export const createSingleUrlDownloadPlan = ({
  sourceUrl,
  audioBitrate,
  createId,
  importId,
  metadata,
}: CreateSingleUrlDownloadPlanInput): SingleUrlDownloadPlan => {
  const id = createId();
  const title = metadata?.title || titleFromSourceUrl(sourceUrl);
  const pendingFile = createPendingDownloadTrack(
    id,
    createDownloadMetadata({
      title,
      artist: metadata?.artist ?? "",
      album: "",
      genre: "",
    }),
    false,
    { sourceUrl, audioBitrate, ...(importId ? { importId } : {}) },
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
  createId,
  importId,
}: CreatePlaylistDownloadPlanInput): PlaylistDownloadPlan => {
  const albumId = createId();
  const pendingFiles = playlist.tracks.map((track) =>
    createPendingDownloadTrack(
      createId(),
      createDownloadMetadata({
        title: track.title,
        artist: playlist.artist,
        album: playlist.title,
        genre: playlist.genre,
        year: playlist.year,
        duration: track.duration,
        trackNumber: track.trackNumber,
      }),
      true,
      {
        sourceUrl: track.url,
        audioBitrate,
        ...(importId ? { importId } : {}),
        trackIndex: track.trackNumber,
        ...(playlist.year === undefined ? {} : { year: playlist.year }),
      },
      createPlaylistPendingMetadataPatch(playlist, track),
    ),
  );
  const album: AlbumGroup = {
    id: albumId,
    title: playlist.title,
    artist: playlist.artist,
    genre: playlist.genre,
    trackIds: pendingFiles.map((file) => file.id),
    year: playlist.year,
    ...(playlist.sourceUrl === undefined ? {} : { sourceUrl: playlist.sourceUrl }),
  };
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

export const createSoundCloudSetDownloadPlan = ({
  set,
  audioBitrate,
  createId,
}: CreateSoundCloudSetDownloadPlanInput): SoundCloudSetDownloadPlan =>
  createPlaylistDownloadPlan({ playlist: set, audioBitrate, createId });

export function startDownloadTrackPlan(
  plan: SingleUrlDownloadPlan,
  deps: SingleUrlDownloadTrackWorkflowDeps,
): void;
export function startDownloadTrackPlan(
  plan: PlaylistDownloadPlan,
  deps: PlaylistDownloadWorkflowDeps,
): void;
export function startDownloadTrackPlan(
  plan: DownloadTrackPlan,
  deps: SingleUrlDownloadTrackWorkflowDeps | SoundCloudSetDownloadWorkflowDeps,
): void {
  deps.bufferCurrentFormMetadata();
  deps.setActiveView("editor");

  const nextFiles = [...deps.getFiles(), ...plan.pendingFiles];
  deps.setFiles(nextFiles);

  if (plan.source === "playlist") {
    const albumDeps = deps as PlaylistDownloadWorkflowDeps;
    albumDeps.setAlbums([...albumDeps.getAlbums(), plan.album]);
  } else {
    deps.addLooseTrackIds?.(plan.looseTrackIds);
  }

  deps.setSelectedAlbumId(plan.selection.selectedAlbumId);
  deps.setSelectedFileId(plan.selection.selectedFileId);
  deps.setSelectedFileIds(plan.selection.selectedFileIds);
  deps.setLastSelectedFileId(plan.selection.lastSelectedFileId);
  deps.queueDownloadTracks(plan.queuedTracks);
}
