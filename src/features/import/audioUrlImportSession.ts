import { analytics, type MediaLinkKind } from "@/analytics";
import { Option, Schema } from "effect";
import { toPublicAudioError } from "@/features/audio/audioErrors";
import type {
  CobaltAudioDownloadLifecycleEvent,
  CobaltAudioDownloadRequest,
} from "@/features/import/cobaltAudio";
import { downloadFromCobalt, provideAudioBackend } from "@/features/audio/audioBackend";
import {
  applyPlaylistImportedCover,
  applySingleAlbumTitlesToFiles,
} from "@/features/library/fileMetadataOps";
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
import { resolveSoundCloudSet } from "@/features/import/soundcloudSet";
import { reportSystemFailure } from "@/features/workspace/systemFailure";
import { resolveTrackMetadata, type TrackMetadata } from "@/features/import/trackMetadata";
import type { TrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import { resolveYouTubePlaylist } from "@/features/import/youtubePlaylist";
import type { Manifest } from "@/features/share/shareManifest";
import { createSharedContentDownloadPlan } from "@/features/share/sharedAlbumDownload";
import { parseMediaLink } from "@/lib/media-link";

type ManagedDownloadTrack = QueuedDownloadTrack & { importOperationId?: string };
const decodeSoundCloudLinkResponse = Schema.decodeUnknownOption(
  Schema.Struct({ canonicalUrl: Schema.String }),
);
const retryProvider = (
  tracks: readonly ManagedDownloadTrack[],
): "youtube" | "soundcloud" | "other" | "mixed" => {
  const providers = new Set(
    tracks.map((track) => {
      try {
        const parsed = parseMediaLink(track.downloadRequest.sourceUrl);
        return parsed.provider === "youtube"
          ? "youtube"
          : parsed.provider === "soundcloud"
            ? "soundcloud"
            : "other";
      } catch {
        return "other";
      }
    }),
  );
  return providers.size === 1 ? providers.values().next().value! : "mixed";
};
type UrlImportEditor = Pick<
  TrackEditorSession["commands"],
  "flush" | "hydrateDownloadedTrack" | "updateTags"
>;

const asUniqueTrackIds = (trackIds: string[]) => [...new Set(trackIds)];
const managedDownloadTrackFromFile = (file: TagiumFile): ManagedDownloadTrack | null => {
  if (!file.downloadRequest) return null;
  const track: ManagedDownloadTrack = {
    fileId: file.id,
    title: file.metadata?.title || file.filename,
    downloadRequest: file.downloadRequest,
  };
  if (file.downloadRequest.importId) track.importOperationId = file.downloadRequest.importId;
  return track;
};
const createPlaylistDownloadModelTrack = (track: ManagedDownloadTrack) => ({
  id: track.fileId,
  title: track.title,
  sourceUrl: track.downloadRequest.sourceUrl,
});

const mediaLinkKindFromUrl = (sourceUrl: string): MediaLinkKind => {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (host === "youtu.be" || host === "on.soundcloud.com" || host === "snd.sc") {
      return "short";
    }
    if (host === "m.youtube.com" || host === "music.youtube.com" || host === "m.soundcloud.com") {
      return "mobile";
    }
    if (host === "youtube-nocookie.com" || host === "www.youtube-nocookie.com") {
      return "nocookie";
    }
    if (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "soundcloud.com" ||
      host === "www.soundcloud.com"
    ) {
      return "canonical";
    }
  } catch {
    // Invalid and generic inputs share the non-identifying "other" kind.
  }
  return "other";
};

const captureTunnelReadiness = (sourceUrl: string, event: CobaltAudioDownloadLifecycleEvent) => {
  if (event.type !== "tunnel-readiness") return;
  analytics.capture({
    type: "cobalt_tunnel_readiness",
    sourceUrl,
    outcome: event.outcome,
    attempts: event.attempts,
    elapsedBucket: event.elapsedBucket,
  });
};

export interface AudioUrlImportSession {
  importUrl: (sourceUrl: string) => Promise<void>;
  retryTrack: (fileId: string) => void;
  cancelQueue: () => void;
  retryQueue: () => void;
  removeTracks: (trackIds: string[]) => void;
  importSharedContent: (
    manifest: Manifest,
    sourceManifestSlug: string,
    cover?: AudioMetadata["picture"],
  ) => Promise<void>;
}

export const createAudioUrlImportSession = ({
  library,
  getEditor,
  getSettings,
  activateEditor,
  setUrlImporting,
  emitQueueSnapshot,
}: {
  library: LibraryStore;
  getEditor: () => UrlImportEditor;
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

  const markDownloadError = (fileId: string, error: Error) => {
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
      downloadTrack: (track) => {
        const request: CobaltAudioDownloadRequest = track.downloadRequest;
        return provideAudioBackend(
          downloadFromCobalt({
            ...request,
            onLifecycle: (event) => {
              try {
                request.onLifecycle?.(event);
              } finally {
                captureTunnelReadiness(request.sourceUrl, event);
              }
            },
          }),
        );
      },
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
      onTrackSettled: (event) => {
        const { track, outcome } = event;
        if (!track.importOperationId) return;
        const settlement: Parameters<typeof importLifecycleTracker.settle>[1] = {
          trackId: track.fileId,
          outcome,
        };
        if (event.outcome === "failed") {
          settlement.error = event.error;
          settlement.failureStage = event.failureStage;
        }
        importLifecycleTracker.settle(track.importOperationId, settlement);
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
        if (event.type === "retry_started") {
          analytics.capture({
            type: "import_retry_started",
            provider: retryProvider(event.tracks),
            retryCount: event.tracks.length,
            previousFailedCount: event.previousSnapshot.failed,
            previousCanceledCount: event.previousSnapshot.canceledCount,
          });
          return;
        }
        analytics.capture({
          type: "import_retry_finished",
          provider: retryProvider(event.tracks),
          retryCount: event.retryCount,
          completedCount: event.completedCount,
          failedCount: event.failedCount,
          canceledCount: event.canceledCount,
          outcome: event.outcome,
          durationMs: event.durationMs,
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
      audioFormat: getSettings().audioFormat,
      createId: () => crypto.randomUUID(),
      importId: importOperationId,
      metadata,
    });
    const pendingFiles = applySingleAlbumTitlesToFiles(
      plan.pendingFiles,
      plan.looseTrackIds,
      getSettings(),
    );
    library.dispatch({
      type: "content-replaced",
      files: [...snapshot.files, ...pendingFiles],
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
      audioFormat: getSettings().audioFormat,
      createId: () => crypto.randomUUID(),
      importId: importOperationId,
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
          getEditor().flush(coverImport.trackIds);
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
    importSharedContent: async (manifest, sourceManifestSlug, cover) => {
      getEditor().flush();
      activateEditor();
      const snapshot = library.getSnapshot();
      const plan = createSharedContentDownloadPlan(
        manifest,
        sourceManifestSlug,
        () => crypto.randomUUID(),
        cover,
      );
      library.dispatch({
        type: "content-replaced",
        files: [...snapshot.files, ...plan.pendingFiles],
        ...(plan.source === "playlist"
          ? { albums: [...snapshot.albums, plan.album] }
          : {
              looseTrackIds: asUniqueTrackIds([...snapshot.looseTrackIds, ...plan.looseTrackIds]),
            }),
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
      let parsed = parseMediaLink(trimmedUrl);
      let shortLinkResolutionAttempted = false;
      let redirected = false;
      if (parsed.kind === "unsupported") {
        try {
          const candidate = new URL(trimmedUrl);
          if (candidate.hostname === "on.soundcloud.com" || candidate.hostname === "snd.sc") {
            shortLinkResolutionAttempted = true;
            const endpoint = new URL("/api/soundcloud-link", window.location.origin);
            endpoint.searchParams.set("url", trimmedUrl);
            const response = await fetch(endpoint);
            if (response.ok) {
              const candidateResult = Option.getOrNull(
                decodeSoundCloudLinkResponse(await response.json()),
              );
              if (candidateResult) {
                const reparsed = parseMediaLink(candidateResult.canonicalUrl);
                if (reparsed.kind !== "unsupported") {
                  parsed = reparsed;
                  redirected = true;
                }
              }
            }
          }
        } catch {
          /* handled by unsupported guard below */
        }
      }
      if (parsed.kind === "unsupported") {
        let isValidHttpsUrl = false;
        try {
          const candidate = new URL(trimmedUrl);
          isValidHttpsUrl =
            candidate.protocol === "https:" &&
            candidate.username === "" &&
            candidate.password === "" &&
            candidate.port === "";
        } catch {
          // Invalid text is reported separately from a valid unsupported provider URL.
        }
        analytics.capture({
          type: "media_link_processed",
          sourceUrl: trimmedUrl,
          mediaKind: "unsupported",
          linkKind: mediaLinkKindFromUrl(trimmedUrl),
          normalized: false,
          redirected: false,
          outcome: "rejected",
          failureReason: shortLinkResolutionAttempted
            ? "resolution_failed"
            : isValidHttpsUrl
              ? "unsupported"
              : "invalid",
        });
        throw new Error(
          shortLinkResolutionAttempted
            ? "soundcloud short-link resolution failed"
            : "unsupported url",
        );
      }
      analytics.capture({
        type: "media_link_processed",
        sourceUrl: trimmedUrl,
        mediaKind: parsed.kind,
        linkKind: mediaLinkKindFromUrl(trimmedUrl),
        normalized: parsed.canonicalUrl !== trimmedUrl,
        redirected,
        outcome: "accepted",
      });
      const normalizedUrl = parsed.canonicalUrl;
      const playlistProvider = parsed.kind === "playlist" ? parsed.provider : null;
      const importOperationId = importLifecycleTracker.start({
        sourceUrl: normalizedUrl,
        importKind: playlistProvider ? "set" : "single",
      });
      setUrlImporting(true);
      try {
        if (playlistProvider) {
          try {
            const playlist =
              playlistProvider === "soundcloud"
                ? await resolveSoundCloudSet(normalizedUrl, importOperationId)
                : await resolveYouTubePlaylist(normalizedUrl);
            // Preserve the canonical URL; provider responses intentionally do
            // not carry request provenance.
            handlePlaylistDownload({ ...playlist, sourceUrl: normalizedUrl }, importOperationId);
          } catch (error) {
            importLifecycleTracker.fail(importOperationId, toPublicAudioError(error));
            throw error;
          }
          return;
        }
        let trackMetadata: TrackMetadata | undefined;
        try {
          trackMetadata = await resolveTrackMetadata(normalizedUrl);
        } catch {
          // Metadata enrichment is optional; URL-derived metadata remains available.
        }
        handleAudioDownload(normalizedUrl, importOperationId, trackMetadata);
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
