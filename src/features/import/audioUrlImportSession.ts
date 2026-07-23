import { analytics } from "@/analytics";
import { downloadFromCobalt, provideAudioBackend } from "@/features/audio/audioBackend";
import { applyPlaylistImportedCover } from "@/features/library/fileMetadataOps";
import {
  createPlaylistDownloadPlan,
  createSingleUrlDownloadPlan,
  fetchImportedCover,
  type QueuedDownloadTrack,
} from "@/features/import/downloadTrack";
import { createImportLifecycleTracker } from "@/features/import/importLifecycle";
import {
  createPlaylistDownloadController,
  type PlaylistDownloadController,
  type PlaylistDownloadControllerSnapshot,
} from "@/features/import/playlistDownloadController";
import type { Playlist } from "@/features/import/playlist";
import { isSoundCloudSetUrl, resolveSoundCloudSet } from "@/features/import/soundcloudSet";
import { reportSystemFailure } from "@/features/workspace/systemFailure";
import { resolveTrackMetadata, type TrackMetadata } from "@/features/import/trackMetadata";
import type { TrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import { isYouTubePlaylistUrl, resolveYouTubePlaylist } from "@/features/import/youtubePlaylist";
import type { Manifest } from "@/features/share/shareManifest";
import { createSharedAlbumDownloadPlan } from "@/features/share/sharedAlbumDownload";

type ManagedDownloadTrack = QueuedDownloadTrack & { importOperationId?: string };
const retryProvider = (
  tracks: readonly ManagedDownloadTrack[],
): "youtube" | "soundcloud" | "other" => {
  const providers = new Set(
    tracks.map((track) => {
      try {
        const host = new URL(track.downloadRequest.sourceUrl).hostname.toLowerCase();
        return host === "youtu.be" || host.includes("youtube")
          ? "youtube"
          : host.includes("soundcloud")
            ? "soundcloud"
            : "other";
      } catch {
        return "other";
      }
    }),
  );
  return providers.size === 1 ? providers.values().next().value! : "other";
};
type UrlImportEditor = Pick<
  TrackEditorSession["commands"],
  "flush" | "hydrateDownloadedTrack" | "updateTags"
>;

const asUniqueTrackIds = (trackIds: string[]) => [...new Set(trackIds)];
const managedDownloadTrackFromFile = (file: TagiumFile): ManagedDownloadTrack | null =>
  file.downloadRequest
    ? {
        fileId: file.id,
        title: file.metadata?.title || file.filename,
        downloadRequest: file.downloadRequest,
      }
    : null;
const createPlaylistDownloadModelTrack = (track: ManagedDownloadTrack) => ({
  id: track.fileId,
  title: track.title,
  sourceUrl: track.downloadRequest.sourceUrl,
});

export interface AudioUrlImportSession {
  importUrl: (sourceUrl: string) => Promise<void>;
  retryTrack: (fileId: string) => void;
  cancelQueue: () => void;
  retryQueue: () => void;
  removeTracks: (trackIds: string[]) => void;
  importSharedAlbum: (
    manifest: Manifest,
    sourceManifestSlug: string,
    cover?: AudioMetadata["picture"],
  ) => Promise<void>;
}

export const createAudioUrlImportSession = ({
  library,
  getEditor,
  resetEditorForm,
  getSettings,
  activateEditor,
  setUrlImporting,
  emitQueueSnapshot,
}: {
  library: LibraryStore;
  getEditor: () => UrlImportEditor;
  resetEditorForm: (metadata: Parameters<TrackEditorSession["form"]["reset"]>[0]) => void;
  getSettings: () => AppSettings;
  activateEditor: () => void;
  setUrlImporting: (importing: boolean) => void;
  emitQueueSnapshot: (snapshot: PlaylistDownloadControllerSnapshot) => void;
}): AudioUrlImportSession => {
  let queueSnapshot: PlaylistDownloadControllerSnapshot | null = null;
  let controller: PlaylistDownloadController<ManagedDownloadTrack> | null = null;
  const importLifecycleTracker = createImportLifecycleTracker({
    capture: analytics.capture,
    createId: () => crypto.randomUUID(),
    now: () => Date.now(),
  });

  const markDownloadError = (fileId: string, error: unknown) => {
    const message = reportSystemFailure(error, "download").trackDescription;
    const nextFiles = library.getSnapshot().files.map((file) =>
      file.id === fileId
        ? {
            ...file,
            status: "error" as const,
            downloadStatus: "error" as const,
            downloadError: message,
          }
        : file,
    );
    library.dispatch({ type: "content-replaced", files: nextFiles });
  };

  const getController = () => {
    if (controller) return controller;
    controller = createPlaylistDownloadController<ManagedDownloadTrack>({
      createModelTrack: createPlaylistDownloadModelTrack,
      downloadTrack: (track) => provideAudioBackend(downloadFromCobalt(track.downloadRequest)),
      hydrateTrack: (track, downloadedFile) =>
        provideAudioBackend(getEditor().hydrateDownloadedTrack(track.fileId, downloadedFile)),
      hasTrack: (trackId) => library.getSnapshot().files.some((file) => file.id === trackId),
      getFileErrorTrackIds: () => {
        const errorTrackIds = new Set<string>();
        for (const file of library.getSnapshot().files) {
          if (file.status === "error") errorTrackIds.add(file.id);
        }
        return errorTrackIds;
      },
      markQueued: (tracks) => {
        const trackIds = new Set(tracks.map((track) => track.fileId));
        const nextFiles = library.getSnapshot().files.map((file) =>
          trackIds.has(file.id)
            ? {
                ...file,
                status: "pending" as const,
                downloadStatus: "downloading" as const,
                downloadError: undefined,
              }
            : file,
        );
        library.dispatch({ type: "content-replaced", files: nextFiles });
      },
      markCanceled: (trackIds) => {
        const trackIdSet = new Set(trackIds);
        const nextFiles = library
          .getSnapshot()
          .files.map((file) =>
            trackIdSet.has(file.id) && file.downloadStatus === "downloading"
              ? { ...file, downloadStatus: "canceled" as const, downloadError: undefined }
              : file,
          );
        library.dispatch({ type: "content-replaced", files: nextFiles });
      },
      markFailed: markDownloadError,
      onTrackSettled: ({ track, outcome, error }) => {
        if (!track.importOperationId) return;
        importLifecycleTracker.settle(track.importOperationId, {
          trackId: track.fileId,
          outcome,
          ...(error === undefined ? {} : { error }),
        });
      },
      onAction: (event) => {
        if (event.type === "cancel_requested") {
          analytics.capture({
            type: "import_cancel_requested",
            totalCount: event.snapshot.total,
            completedCount: event.snapshot.completed,
            activeCount: event.snapshot.active.length,
            pendingCount: event.snapshot.pending,
          });
          return;
        }
        analytics.capture({
          type: "import_retry_started",
          provider: retryProvider(event.tracks),
          retryCount: event.tracks.length,
          previousFailedCount: event.previousSnapshot.failed,
          previousCanceledCount: event.previousSnapshot.canceledCount,
        });
      },
      emitSnapshot: (snapshot) => {
        queueSnapshot = snapshot;
        emitQueueSnapshot(snapshot);
      },
    });
    return controller;
  };

  const queueDownloadTracks = (tracks: ManagedDownloadTrack[]) => {
    if (tracks.length > 0) getController().enqueue(tracks);
  };

  const handleAudioDownload = (
    sourceUrl: string,
    importOperationId: string,
    metadata?: TrackMetadata,
  ) => {
    getEditor().flush();
    activateEditor();
    const snapshot = library.getSnapshot();
    const plan = createSingleUrlDownloadPlan({
      sourceUrl,
      audioBitrate: getSettings().audioBitrate,
      createId: () => crypto.randomUUID(),
      metadata,
    });
    library.dispatch({
      type: "content-replaced",
      files: [...snapshot.files, ...plan.pendingFiles],
      looseTrackIds: asUniqueTrackIds([...snapshot.looseTrackIds, ...plan.looseTrackIds]),
      selection: {
        selectedAlbumId: plan.selection.selectedAlbumId,
        selectedFileId: plan.selection.selectedFileId,
        selectedFileIds: plan.selection.selectedFileIds,
        rangeAnchorFileId: plan.selection.lastSelectedFileId,
      },
    });
    importLifecycleTracker.resolve(importOperationId, {
      trackIds: plan.queuedTracks.map((track) => track.fileId),
      hasCover: false,
    });
    queueDownloadTracks(plan.queuedTracks.map((track) => ({ ...track, importOperationId })));
  };

  const handlePlaylistDownload = (playlist: Playlist, importOperationId: string) => {
    getEditor().flush();
    activateEditor();
    const snapshot = library.getSnapshot();
    const plan = createPlaylistDownloadPlan({
      playlist,
      audioBitrate: getSettings().audioBitrate,
      createId: () => crypto.randomUUID(),
    });
    library.dispatch({
      type: "content-replaced",
      files: [...snapshot.files, ...plan.pendingFiles],
      albums: [...snapshot.albums, plan.album],
      selection: {
        selectedAlbumId: plan.selection.selectedAlbumId,
        selectedFileId: plan.selection.selectedFileId,
        selectedFileIds: plan.selection.selectedFileIds,
        rangeAnchorFileId: plan.selection.lastSelectedFileId,
      },
    });

    if (plan.coverImport) {
      const coverImport = plan.coverImport;
      void (async () => {
        try {
          const cover = await fetchImportedCover(coverImport.coverUrl);
          const current = library.getSnapshot();
          const covered = applyPlaylistImportedCover(
            current.files,
            current.albums,
            coverImport.albumId,
            coverImport.trackIds,
            coverImport.playlist,
            getSettings(),
            cover,
            current.selectedFileId,
          );
          library.dispatch({
            type: "content-replaced",
            albums: covered.albums,
            files: covered.files,
          });
          if (covered.files === current.files) return;
          if (covered.selectedMetadata) {
            resetEditorForm(covered.selectedMetadata);
          }
          const trackIdSet = new Set(coverImport.trackIds);
          await Promise.all(
            covered.files.flatMap((file) => {
              if (!trackIdSet.has(file.id) || !file.file || !file.metadata) return [];
              return [
                getEditor()
                  .updateTags(file, file.metadata)
                  .catch(() => {
                    // updateTags records the per-track error state.
                  }),
              ];
            }),
          );
        } catch (error) {
          reportSystemFailure(error, "cover-import");
        }
      })();
    }

    importLifecycleTracker.resolve(importOperationId, {
      trackIds: plan.queuedTracks.map((track) => track.fileId),
      hasCover: Boolean(playlist.coverUrl),
    });
    queueDownloadTracks(plan.queuedTracks.map((track) => ({ ...track, importOperationId })));
  };

  return {
    importSharedAlbum: async (manifest, sourceManifestSlug, cover) => {
      getEditor().flush();
      activateEditor();
      const snapshot = library.getSnapshot();
      const plan = createSharedAlbumDownloadPlan(
        manifest,
        sourceManifestSlug,
        () => crypto.randomUUID(),
        cover,
      );
      library.dispatch({
        type: "content-replaced",
        files: [...snapshot.files, ...plan.pendingFiles],
        albums: [...snapshot.albums, plan.album],
        selection: {
          selectedAlbumId: plan.selection.selectedAlbumId,
          selectedFileId: plan.selection.selectedFileId,
          selectedFileIds: plan.selection.selectedFileIds,
          rangeAnchorFileId: plan.selection.lastSelectedFileId,
        },
      });
      queueDownloadTracks(plan.queuedTracks);
    },
    importUrl: async (sourceUrl) => {
      const trimmedUrl = sourceUrl.trim();
      if (!trimmedUrl) return;
      const playlistProvider = isSoundCloudSetUrl(trimmedUrl)
        ? "soundcloud"
        : isYouTubePlaylistUrl(trimmedUrl)
          ? "youtube"
          : null;
      const importOperationId = importLifecycleTracker.start({
        sourceUrl: trimmedUrl,
        importKind: playlistProvider ? "set" : "single",
      });
      setUrlImporting(true);
      try {
        if (playlistProvider) {
          try {
            const playlist =
              playlistProvider === "soundcloud"
                ? await resolveSoundCloudSet(trimmedUrl)
                : await resolveYouTubePlaylist(trimmedUrl);
            // Preserve the exact validated URL submitted by the user; provider
            // responses intentionally do not carry request provenance.
            handlePlaylistDownload({ ...playlist, sourceUrl: trimmedUrl }, importOperationId);
          } catch (error) {
            importLifecycleTracker.fail(importOperationId, error, "resolve");
            throw error;
          }
          return;
        }
        let trackMetadata: TrackMetadata | undefined;
        try {
          trackMetadata = await resolveTrackMetadata(trimmedUrl);
        } catch {
          // Metadata enrichment is optional; URL-derived metadata remains available.
        }
        handleAudioDownload(trimmedUrl, importOperationId, trackMetadata);
      } finally {
        setUrlImporting(false);
      }
    },
    retryTrack: (fileId) => {
      const file = library.getSnapshot().files.find((entry) => entry.id === fileId);
      const track = file && managedDownloadTrackFromFile(file);
      if (track) getController().retry([track]);
    },
    cancelQueue: () => getController().cancel(),
    retryQueue: () => {
      if (!queueSnapshot || queueSnapshot.active.length > 0) return;
      const trackIds = new Set(queueSnapshot.trackIds);
      const tracks = library.getSnapshot().files.flatMap((file) => {
        if (!trackIds.has(file.id) || file.file) return [];
        const track = managedDownloadTrackFromFile(file);
        return track ? [track] : [];
      });
      getController().retry(tracks);
    },
    removeTracks: (trackIds) => controller?.remove(trackIds),
  };
};
