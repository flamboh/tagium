import type { AlbumMetadataDialogProps } from "./AlbumMetadataDialog";
import type { DestructiveActionDialogProps } from "./DestructiveActionDialog";
import type { MetadataCleanupDialogProps } from "./MetadataCleanupDialog";
import type { SettingsPageProps } from "./SettingsPage";
import type { TagSidebarPanelProps } from "./TagSidebarPanel";
import type { AppSettings } from "./types";
import type { TrackEditorSession } from "./useTrackEditorSession";
import type { LibraryStore } from "./useLibraryStore";
import { useWorkspaceAlbumDialog } from "./useWorkspaceAlbumDialog";
import { useWorkspaceCleanup } from "./useWorkspaceCleanup";
import { useWorkspaceSelection } from "./useWorkspaceSelection";
import { useWorkspaceSettings } from "./useWorkspaceSettings";
import type { ActiveView, SetActiveView } from "./audioWorkspaceTypes";

export type { ActiveView } from "./audioWorkspaceTypes";

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
  const cleanupDialogProps = useWorkspaceCleanup({ library, editor, settings, busy });
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
    cleanupDialogProps,
    removalDialogProps: selection.removalDialogProps,
    albumDialogProps: album.dialogProps,
    settingsPageProps,
    sidebarProps: {
      ...selection.sidebarProps,
      ...album.sidebarProps,
      settingsOpen: activeView === "settings",
      onOpenSettings: settingsPageProps.onBack,
    },
  };
};
