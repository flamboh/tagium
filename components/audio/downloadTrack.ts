import filenamify from "filenamify";
import type { SoundCloudSet } from "./soundcloudSet";
import type { AlbumGroup, AppSettings, AudioMetadata, MetadataPatch, TagiumFile } from "./types";

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

export interface SoundCloudSetCoverImportPlan {
  albumId: string;
  trackIds: string[];
  coverUrl: string;
  set: SoundCloudSet;
}

export interface SoundCloudSetDownloadPlan extends DownloadTrackPlanBase {
  source: "soundcloud-set";
  album: AlbumGroup;
  coverImport: SoundCloudSetCoverImportPlan | null;
}

export type DownloadTrackPlan = SingleUrlDownloadPlan | SoundCloudSetDownloadPlan;

export interface CreateSingleUrlDownloadPlanInput {
  sourceUrl: string;
  audioBitrate: AppSettings["audioBitrate"];
  createId: () => string;
}

export interface CreateSoundCloudSetDownloadPlanInput {
  set: SoundCloudSet;
  audioBitrate: AppSettings["audioBitrate"];
  createId: () => string;
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

export interface SoundCloudSetDownloadWorkflowDeps extends DownloadTrackWorkflowDeps {
  getAlbums: () => AlbumGroup[];
  setAlbums: (albums: AlbumGroup[]) => void;
}

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

export const fetchImportedCover = async (coverUrl: string): Promise<AudioMetadata["picture"]> => {
  const response = await fetch(coverUrl);

  if (!response.ok) {
    throw new Error(`album cover request failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType) {
    throw new Error("album cover response missing content type.");
  }

  return [
    {
      format: contentType,
      type: 3,
      data: new Uint8Array(await response.arrayBuffer()),
      description: "album cover",
    },
  ];
};

export const createQueuedDownloadTrack = (file: PendingDownloadTrack): QueuedDownloadTrack => ({
  fileId: file.id,
  title: file.metadata.title || file.filename.replace(/\.mp3$/i, "") || "downloading audio",
  downloadRequest: file.downloadRequest,
});

export const createQueuedDownloadTracks = (
  files: readonly PendingDownloadTrack[],
): QueuedDownloadTrack[] => files.map(createQueuedDownloadTrack);

const createSoundCloudSetPendingMetadataPatch = (
  set: SoundCloudSet,
  track: SoundCloudSet["tracks"][number],
): MetadataPatch => ({
  title: track.title,
  artist: set.artist,
  album: set.title,
  genre: set.genre,
  ...(set.year !== undefined ? { year: set.year } : {}),
  ...(track.trackNumber !== undefined ? { trackNumber: track.trackNumber } : {}),
});

export const createSingleUrlDownloadPlan = ({
  sourceUrl,
  audioBitrate,
  createId,
}: CreateSingleUrlDownloadPlanInput): SingleUrlDownloadPlan => {
  const id = createId();
  const title = titleFromSourceUrl(sourceUrl);
  const pendingFile = createPendingDownloadTrack(
    id,
    createDownloadMetadata({
      title,
      artist: "",
      album: "",
      genre: "",
    }),
    false,
    { sourceUrl, audioBitrate },
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

export const createSoundCloudSetDownloadPlan = ({
  set,
  audioBitrate,
  createId,
}: CreateSoundCloudSetDownloadPlanInput): SoundCloudSetDownloadPlan => {
  const albumId = createId();
  const pendingFiles = set.tracks.map((track) =>
    createPendingDownloadTrack(
      createId(),
      createDownloadMetadata({
        title: track.title,
        artist: set.artist,
        album: set.title,
        genre: set.genre,
        year: set.year,
        duration: track.duration,
        trackNumber: track.trackNumber,
      }),
      true,
      { sourceUrl: track.url, audioBitrate },
      createSoundCloudSetPendingMetadataPatch(set, track),
    ),
  );
  const album: AlbumGroup = {
    id: albumId,
    title: set.title,
    artist: set.artist,
    genre: set.genre,
    trackIds: pendingFiles.map((file) => file.id),
    year: set.year,
  };
  const firstPendingFileId = pendingFiles[0]?.id ?? null;

  return {
    source: "soundcloud-set",
    pendingFiles,
    queuedTracks: createQueuedDownloadTracks(pendingFiles),
    selection: {
      selectedAlbumId: albumId,
      selectedFileId: firstPendingFileId,
      selectedFileIds: new Set(firstPendingFileId ? [firstPendingFileId] : []),
      lastSelectedFileId: firstPendingFileId,
    },
    album,
    coverImport: set.coverUrl
      ? {
          albumId,
          trackIds: album.trackIds,
          coverUrl: set.coverUrl,
          set,
        }
      : null,
  };
};

export function startDownloadTrackPlan(
  plan: SingleUrlDownloadPlan,
  deps: SingleUrlDownloadTrackWorkflowDeps,
): void;
export function startDownloadTrackPlan(
  plan: SoundCloudSetDownloadPlan,
  deps: SoundCloudSetDownloadWorkflowDeps,
): void;
export function startDownloadTrackPlan(
  plan: DownloadTrackPlan,
  deps: SingleUrlDownloadTrackWorkflowDeps | SoundCloudSetDownloadWorkflowDeps,
): void {
  deps.bufferCurrentFormMetadata();
  deps.setActiveView("editor");

  const nextFiles = [...deps.getFiles(), ...plan.pendingFiles];
  deps.setFiles(nextFiles);

  if (plan.source === "soundcloud-set") {
    const albumDeps = deps as SoundCloudSetDownloadWorkflowDeps;
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
