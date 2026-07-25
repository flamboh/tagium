import type { AlbumMetadataDialogProps } from "@/features/editor/AlbumMetadataDialog";
import type { DestructiveActionDialogProps } from "@/features/workspace/DestructiveActionDialog";
import type { MetadataCleanupDialogProps } from "@/features/library/MetadataCleanupDialog";
import type { SettingsPageProps } from "@/features/settings/SettingsPage";
import type { TagSidebarPanelProps } from "@/features/library/TagSidebarPanel";
import type { AppSettings } from "@/features/library/types";
import type { TrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import { useWorkspaceAlbumDialog } from "@/features/workspace/useWorkspaceAlbumDialog";
import { useWorkspaceCleanup } from "@/features/workspace/useWorkspaceCleanup";
import { useWorkspaceSelection } from "@/features/workspace/useWorkspaceSelection";
import { useWorkspaceSettings } from "@/features/settings/useWorkspaceSettings";
import type { ActiveView, SetActiveView } from "@/features/workspace/audioWorkspaceTypes";

export type { ActiveView } from "@/features/workspace/audioWorkspaceTypes";

type WorkspaceEditor = Pick<TrackEditorSession, "isCoverProcessing"> & {
  commands: Pick<TrackEditorSession["commands"], "flush">;
  form: Pick<TrackEditorSession["form"], "reset">;
};

type WorkspaceSidebarProps = Pick<
  TagSidebarPanelProps,
  | "settingsOpen"
  | "onSelectAlbum"
  | "onSelectFile"
  | "onSelectLooseTrack"
  | "onClearSelection"
  | "onRemoveFile"
  | "onAddAlbum"
  | "onEditAlbum"
  | "cleanupSuggestionCountByAlbumId"
  | "onReviewAlbumCleanup"
  | "onMoveTrackToAlbum"
  | "onMoveTrackToLoose"
  | "onPromptCreateAlbumFromLooseTracks"
  | "onReorderAlbums"
  | "onOpenSettings"
>;

export interface AudioWorkspace {
  cleanupDialogProps: MetadataCleanupDialogProps;
  removalDialogProps: DestructiveActionDialogProps;
  albumDialogProps: AlbumMetadataDialogProps;
  settingsPageProps: SettingsPageProps;
  sidebarProps: WorkspaceSidebarProps;
}

export const useAudioWorkspace = ({
  library,
  editor,
  settings,
  setSettings,
  activeView,
  setActiveView,
  removeDownloads,
  busy,
}: {
  library: LibraryStore;
  editor: WorkspaceEditor;
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  activeView: ActiveView;
  setActiveView: SetActiveView;
  removeDownloads: (trackIds: string[]) => void;
  busy: boolean;
}): AudioWorkspace => {
  const cleanup = useWorkspaceCleanup({ library, editor, settings, busy });
  const selection = useWorkspaceSelection({
    library,
    editor,
    settings,
    setActiveView,
    removeDownloads,
  });
  const album = useWorkspaceAlbumDialog({ library, editor, settings, removeDownloads });
  const settingsPageProps = useWorkspaceSettings({
    library,
    editor,
    settings,
    setSettings,
    setActiveView,
  });

  return {
    cleanupDialogProps: cleanup.dialogProps,
    removalDialogProps: selection.removalDialogProps,
    albumDialogProps: album.dialogProps,
    settingsPageProps,
    sidebarProps: {
      ...selection.sidebarProps,
      ...album.sidebarProps,
      cleanupSuggestionCountByAlbumId: cleanup.cleanupSuggestionCountByAlbumId,
      onReviewAlbumCleanup: cleanup.onReviewAlbum,
      settingsOpen: activeView === "settings",
      onOpenSettings: settingsPageProps.onBack,
    },
  };
};
