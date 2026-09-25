import { useState } from "react";
import { getMediaUrlEntryPresentation } from "@/features/import/mediaUrlEntryPresentation";
import { useMediaUrlEntryController } from "@/features/import/useMediaUrlEntryController";
import { useExportSession } from "@/features/export/useExportSession";
import { useLibraryStore } from "@/features/library/useLibraryStore";
import { useTrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { AppSettings } from "@/features/library/types";
import {
  classifyShareLink,
  InvalidShareLinkError,
  ShareLinksDisabledError,
} from "@/features/share/shareLink";
import { useShareWorkflow } from "@/features/share/useShareWorkflow";
import { shareLinksEnabled } from "@/features/share/shareFeature";
import { useShareLinkSpotlight } from "@/features/share/useShareLinkSpotlight";
import { useAudioTaggerMobileNavigation } from "@/features/workspace/useAudioTaggerMobileNavigation";
import { useWorkspaceNavigation } from "@/features/workspace/workspaceNavigation";
import {
  hasRecoverableSessionWork,
  useBeforeUnloadProtection,
} from "@/features/workspace/sessionSafety";
import { loadAppSettings } from "@/features/settings/settings";
import { useAudioImportSession } from "@/features/workspace/useAudioImportSession";
import { useAudioWorkspace } from "@/features/workspace/useAudioWorkspace";

export function useAudioTaggerController() {
  const library = useLibraryStore();
  const [settings, setSettings] = useState<AppSettings>(loadAppSettings);
  const editor = useTrackEditorSession({ library, settings });
  const workspaceNavigation = useWorkspaceNavigation({ library, editor });
  const activeView = workspaceNavigation.activeView;
  const activateEditor = workspaceNavigation.showEditor;
  const exporting = useExportSession({ library, editor: editor.commands, settings });
  const importing = useAudioImportSession({ library, editor, settings, activateEditor });
  const sharing = useShareWorkflow({ library, editor, importing, enabled: shareLinksEnabled });
  const busy = importing.status.importing || exporting.exporting;
  const workspace = useAudioWorkspace({
    library,
    editor,
    settings,
    setSettings,
    navigation: workspaceNavigation,
    removeDownloads: importing.commands.removeTracks,
    busy,
  });
  const mobile = useAudioTaggerMobileNavigation({ navigation: workspaceNavigation, workspace });
  const { files, albums, looseTrackIds } = library.state;
  const shareAlbumActions = shareLinksEnabled ? sharing.shareActions : undefined;
  const shareTrackActions = shareLinksEnabled ? sharing.shareTrackActions : undefined;
  const shareSpotlight = useShareLinkSpotlight({
    albums,
    files,
    shareAlbumActions,
    shareTrackActions,
    visible: !mobile.navigation.isMobile || mobile.navigation.drawerOpen,
  });
  const libraryIsEmpty = files.length === 0 && albums.length === 0 && looseTrackIds.length === 0;
  const landingIsActive = libraryIsEmpty && activeView === "editor";
  useBeforeUnloadProtection(
    hasRecoverableSessionWork({
      fileCount: files.length,
      albumCount: albums.length,
      importing: busy,
    }),
  );

  const handleUrlImport = async (sourceUrl: string) => {
    const classification = classifyShareLink(sourceUrl);
    if (classification.kind === "invalid-share") throw new InvalidShareLinkError();
    if (classification.kind === "share" && !shareLinksEnabled) throw new ShareLinksDisabledError();
    if (classification.kind === "share") {
      await sharing.importFromInput(classification.slug);
      return;
    }
    await importing.commands.importUrl(sourceUrl);
  };
  const mediaUrlEntryController = useMediaUrlEntryController(handleUrlImport);
  const mediaUrlEntryPresentation = getMediaUrlEntryPresentation(
    libraryIsEmpty,
    activeView === "settings",
    Boolean(editor.selectedFile),
  );

  return {
    library,
    settings,
    editor,
    activeView,
    exporting,
    importing,
    sharing,
    busy,
    workspace,
    mobile,
    shareAlbumActions,
    shareTrackActions,
    shareSpotlight,
    libraryIsEmpty,
    landingIsActive,
    mediaUrlEntryController,
    mediaUrlEntryPresentation,
  };
}

export type AudioTaggerController = ReturnType<typeof useAudioTaggerController>;
