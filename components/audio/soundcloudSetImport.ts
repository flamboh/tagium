import filenamify from "filenamify";
import { applySoundCloudSetImportedCover } from "./fileMetadataOps";
import type { SoundCloudSet } from "./soundcloudSet";
import type { AlbumGroup, AppSettings, AudioMetadata, TagiumFile } from "./types";

const filenameFromTitle = (title: string) => {
  const filename = filenamify(title.trim(), { replacement: "-" });
  if (filename) return `${filename}.mp3`;
  return "downloading-track.mp3";
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
  year,
  genre,
  duration: duration ?? 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  trackNumber,
});

export const createPendingDownloadTrack = (
  id: string,
  metadata: AudioMetadata,
  hasBufferedChanges: boolean,
  downloadRequest: NonNullable<TagiumFile["downloadRequest"]>,
): TagiumFile => ({
  id,
  filename: `${metadata.filename}.mp3`,
  status: "pending",
  downloadStatus: "downloading",
  downloadRequest,
  hasBufferedChanges,
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

interface SoundCloudSetImportDeps {
  settings: Pick<AppSettings, "audioBitrate" | "applySoundCloudAlbumCoverToTracks">;
  bufferCurrentFormMetadata: () => void;
  setActiveView: (view: "editor") => void;
  getFiles: () => TagiumFile[];
  setFiles: (files: TagiumFile[]) => void;
  getAlbums: () => AlbumGroup[];
  setAlbums: (albums: AlbumGroup[]) => void;
  setSelectedAlbumId: (albumId: string | null) => void;
  setSelectedFileId: (fileId: string | null) => void;
  setSelectedFileIds: (fileIds: Set<string>) => void;
  setLastSelectedFileId: (fileId: string | null) => void;
  createId: () => string;
  fetchImportedCover: (coverUrl: string) => Promise<AudioMetadata["picture"]>;
  downloadCobaltAudio: (request: NonNullable<TagiumFile["downloadRequest"]>) => Promise<File>;
  hydrateDownloadedTrack: (fileId: string, downloadedFile: File) => Promise<void>;
  markDownloadError: (fileId: string, error: unknown) => void;
  updateTags: (file: TagiumFile, metadata: AudioMetadata) => Promise<void>;
  warn: (message: string, error: unknown) => void;
}

export const startSoundCloudSetImport = (set: SoundCloudSet, deps: SoundCloudSetImportDeps) => {
  deps.bufferCurrentFormMetadata();
  deps.setActiveView("editor");

  const albumId = deps.createId();
  const pendingFiles = set.tracks.map((track) =>
    createPendingDownloadTrack(
      deps.createId(),
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
      { sourceUrl: track.url, audioBitrate: deps.settings.audioBitrate },
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
  const nextFiles = [...deps.getFiles(), ...pendingFiles];
  const nextAlbums = [...deps.getAlbums(), album];
  deps.setFiles(nextFiles);
  deps.setAlbums(nextAlbums);
  deps.setSelectedAlbumId(albumId);

  let firstPendingFileId: string | null = null;
  const firstPendingFile = pendingFiles[0];
  if (firstPendingFile) {
    firstPendingFileId = firstPendingFile.id;
  }
  deps.setSelectedFileId(firstPendingFileId);
  const selectedFileIds = new Set<string>();
  if (firstPendingFileId) {
    selectedFileIds.add(firstPendingFileId);
  }
  deps.setSelectedFileIds(selectedFileIds);
  deps.setLastSelectedFileId(firstPendingFileId);

  const coverUrl = set.coverUrl;
  if (coverUrl) {
    void (async () => {
      try {
        const cover = await deps.fetchImportedCover(coverUrl);
        const { albums: coveredAlbums, files: coveredFiles } = applySoundCloudSetImportedCover(
          deps.getFiles(),
          deps.getAlbums(),
          albumId,
          album.trackIds,
          set,
          deps.settings,
          cover,
          null,
        );
        deps.setAlbums(coveredAlbums);
        if (coveredFiles === deps.getFiles()) return;

        deps.setFiles(coveredFiles);
        const trackIdSet = new Set(album.trackIds);
        await Promise.all(
          coveredFiles
            .filter((file) => trackIdSet.has(file.id) && Boolean(file.file) && file.metadata)
            .map(async (file) => {
              if (!file.metadata) return;
              try {
                await deps.updateTags(file, file.metadata);
              } catch {
                // updateTags records the per-track error state.
              }
            }),
        );
      } catch (error) {
        deps.warn("failed to import album cover:", error);
      }
    })();
  }

  pendingFiles.forEach((pendingFile, index) => {
    const track = set.tracks[index];
    if (!track) return;
    void (async () => {
      try {
        const downloadedFile = await deps.downloadCobaltAudio({
          sourceUrl: track.url,
          audioBitrate: deps.settings.audioBitrate,
        });
        await deps.hydrateDownloadedTrack(pendingFile.id, downloadedFile);
      } catch (error) {
        deps.markDownloadError(pendingFile.id, error);
      }
    })();
  });
};
