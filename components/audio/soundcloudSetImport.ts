import {
  createSoundCloudSetDownloadPlan,
  startDownloadTrackPlan,
  type SoundCloudSetDownloadWorkflowDeps,
  type SoundCloudSetDownloadPlan,
} from "./downloadTrack";
import { applySoundCloudSetImportedCover } from "./fileMetadataOps";
import type { SoundCloudSet } from "./soundcloudSet";
import type { AppSettings, AudioMetadata, TagiumFile } from "./types";

interface SoundCloudSetImportDeps extends SoundCloudSetDownloadWorkflowDeps {
  settings: Pick<AppSettings, "audioBitrate" | "applySoundCloudAlbumCoverToTracks">;
  createId: () => string;
  fetchImportedCover: (coverUrl: string) => Promise<AudioMetadata["picture"]>;
  updateTags: (file: TagiumFile, metadata: AudioMetadata) => Promise<void>;
  warn: (message: string, error: unknown) => void;
  getSelectedFileId?: () => string | null;
  setSelectedMetadata?: (metadata: AudioMetadata) => void;
}

const startSoundCloudSetCoverImport = (
  plan: SoundCloudSetDownloadPlan,
  deps: Pick<
    SoundCloudSetImportDeps,
    | "settings"
    | "getFiles"
    | "setFiles"
    | "getAlbums"
    | "setAlbums"
    | "fetchImportedCover"
    | "updateTags"
    | "warn"
    | "getSelectedFileId"
    | "setSelectedMetadata"
  >,
) => {
  const coverImport = plan.coverImport;
  if (!coverImport) return;

  void (async () => {
    try {
      const cover = await deps.fetchImportedCover(coverImport.coverUrl);
      const {
        albums: coveredAlbums,
        files: coveredFiles,
        selectedMetadata,
      } = applySoundCloudSetImportedCover(
        deps.getFiles(),
        deps.getAlbums(),
        coverImport.albumId,
        coverImport.trackIds,
        coverImport.playlist,
        deps.settings,
        cover,
        deps.getSelectedFileId?.() ?? null,
      );
      deps.setAlbums(coveredAlbums);
      if (coveredFiles === deps.getFiles()) return;

      deps.setFiles(coveredFiles);
      if (selectedMetadata) {
        deps.setSelectedMetadata?.(selectedMetadata);
      }

      const trackIdSet = new Set(coverImport.trackIds);
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
};

export const startSoundCloudSetImport = (
  set: SoundCloudSet,
  deps: SoundCloudSetImportDeps,
): SoundCloudSetDownloadPlan => {
  const plan = createSoundCloudSetDownloadPlan({
    set,
    audioBitrate: deps.settings.audioBitrate,
    createId: deps.createId,
  });

  startDownloadTrackPlan(plan, deps);
  startSoundCloudSetCoverImport(plan, deps);
  return plan;
};
