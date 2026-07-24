"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import AlbumMetadataDialog from "@/features/editor/AlbumMetadataDialog";
import DestructiveActionDialog from "@/features/workspace/DestructiveActionDialog";
import LandingScreen from "@/features/import/LandingScreen";
import MediaUrlEntry, { useMediaUrlEntryController } from "@/features/import/MediaUrlEntry";
import MetadataCleanupDialog from "@/features/library/MetadataCleanupDialog";
import SettingsPage from "@/features/settings/SettingsPage";
import TagSidebarPanel from "@/features/library/TagSidebarPanel";
import TrackMetadataEditor from "@/features/editor/TrackMetadataEditor";
import { getMediaUrlEntryPresentation } from "@/features/import/mediaUrlEntryPresentation";
import {
  hasRecoverableSessionWork,
  useBeforeUnloadProtection,
} from "@/features/workspace/sessionSafety";
import { loadAppSettings } from "@/features/settings/settings";
import { useAudioImportSession } from "@/features/workspace/useAudioImportSession";
import { useAudioWorkspace, type ActiveView } from "@/features/workspace/useAudioWorkspace";
import { useExportSession } from "@/features/export/useExportSession";
import { useLibraryStore } from "@/features/library/useLibraryStore";
import { useTrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { AppSettings } from "@/features/library/types";
import ShareAlbumDialog from "@/features/share/ShareAlbumDialog";
import SharedAlbumPage from "@/features/share/SharedAlbumPage";
import {
  classifyShareLink,
  InvalidShareLinkError,
  ShareLinksDisabledError,
} from "@/features/share/shareLink";
import { useShareWorkflow } from "@/features/share/useShareWorkflow";
import { shareLinksEnabled } from "@/features/share/shareFeature";
import { useMobileWorkspaceNavigation } from "@/features/workspace/mobileWorkspaceNavigation";
import { shouldStartDrawerSwipe, decideDrawerSwipe } from "@/features/workspace/drawerSwipe";

export default function AudioTagger() {
  const library = useLibraryStore();
  const [activeView, setActiveView] = useState<ActiveView>("editor");
  const [settings, setSettings] = useState<AppSettings>(loadAppSettings);
  const navigation = useMobileWorkspaceNavigation({ activeView, setActiveView });
  const drawerRef = useRef<HTMLDivElement>(null);
  const wasDrawerOpenRef = useRef(false);
  const activateEditor = useCallback(() => setActiveView("editor"), []);
  const editor = useTrackEditorSession({ library, settings });
  const exporting = useExportSession({ library, editor: editor.commands, settings });
  const importing = useAudioImportSession({
    library,
    editor,
    settings,
    activateEditor,
  });
  const sharing = useShareWorkflow({ library, editor, importing, enabled: shareLinksEnabled });
  const busy = importing.status.importing || exporting.exporting;
  const workspace = useAudioWorkspace({
    library,
    editor,
    settings,
    setSettings,
    activeView,
    setActiveView,
    removeDownloads: importing.commands.removeTracks,
    busy,
  });
  const mobileSidebarProps = {
    ...workspace.sidebarProps,
    onSelectAlbum: (albumId: string, event?: React.MouseEvent) => {
      navigation.runAfterDrawerClose(() => workspace.sidebarProps.onSelectAlbum(albumId, event));
    },
    onSelectFile: (albumId: string, fileId: string, event?: React.MouseEvent) => {
      navigation.runAfterDrawerClose(() =>
        workspace.sidebarProps.onSelectFile(albumId, fileId, event),
      );
    },
    onSelectLooseTrack: (fileId: string, event?: React.MouseEvent) => {
      navigation.runAfterDrawerClose(() =>
        workspace.sidebarProps.onSelectLooseTrack(fileId, event),
      );
    },
    onEditAlbum: (albumId: string) =>
      navigation.runAfterDrawerClose(() => workspace.sidebarProps.onEditAlbum(albumId)),
    onAddAlbum: () => navigation.runAfterDrawerClose(workspace.sidebarProps.onAddAlbum),
    onRemoveFile: (fileId: string) =>
      navigation.runAfterDrawerClose(() => workspace.sidebarProps.onRemoveFile(fileId)),
    onPromptCreateAlbumFromLooseTracks: (source: string, target: string) =>
      navigation.runAfterDrawerClose(() =>
        workspace.sidebarProps.onPromptCreateAlbumFromLooseTracks(source, target),
      ),
    onOpenSettings: () =>
      navigation.runAfterDrawerClose(() => {
        if (workspace.sidebarProps.settingsOpen) navigation.backWorkspace();
        else navigation.navigateToView("settings");
      }),
  };
  const mobileSettingsProps = {
    ...workspace.settingsPageProps,
    onBack: () => navigation.runAfterDrawerClose(navigation.backWorkspace),
  };
  useEffect(() => {
    if (!navigation.drawerOpen) {
      if (wasDrawerOpenRef.current) {
        navigation.openerRef.current?.focus();
        navigation.openerRef.current = null;
      }
      wasDrawerOpenRef.current = false;
      return;
    }
    wasDrawerOpenRef.current = true;
    const drawer = drawerRef.current;
    const selector = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
    const getItems = () =>
      Array.from(drawer?.querySelectorAll<HTMLElement>(selector) ?? []).filter((item) => {
        const style = window.getComputedStyle(item);
        return (
          !item.hasAttribute("disabled") &&
          item.getAttribute("aria-hidden") !== "true" &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      });
    getItems()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        navigation.closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const items = getItems();
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? index <= 0
          ? items.length - 1
          : index - 1
        : (index + 1) % items.length;
      event.preventDefault();
      items[next]?.focus();
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [navigation]);
  useEffect(() => {
    if (!navigation.isMobile) return;
    let start: { clientX: number; clientY: number; pointerType?: string } | null = null;
    const down = (event: PointerEvent) => {
      if (!navigation.drawerOpen && shouldStartDrawerSwipe(event, window.innerWidth, event.target))
        start = event;
    };
    const move = (event: PointerEvent) => {
      if (!start) return;
      const decision = decideDrawerSwipe(start, event);
      if (decision === "open") {
        navigation.openDrawer();
        start = null;
      } else if (decision === "ignore") start = null;
    };
    const clear = () => {
      start = null;
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };
  }, [navigation]);
  const { files, albums, looseTrackIds, selectedFileId, selectedAlbumId, selectedFileIds } =
    library.state;
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

  if (shareLinksEnabled && sharing.page) {
    return (
      <SharedAlbumPage
        state={sharing.page}
        workspaceTrackCount={files.length}
        anotherTabOpen={sharing.anotherTabOpen}
        alreadyAddedAlbumId={sharing.alreadyAddedAlbumId}
        adding={sharing.adding}
        canStopSharing={sharing.canStopSharing}
        onBack={sharing.back}
        onOpenTagium={sharing.openTagium}
        onAdd={sharing.addSharedAlbum}
        onViewAlbum={sharing.viewAlreadyAdded}
        onStopSharing={sharing.stopPageShare}
      />
    );
  }

  return (
    <>
      <ShareAlbumDialog
        state={sharing.dialog}
        onClose={sharing.closeDialog}
        onPublish={sharing.publish}
        onStopSharing={sharing.stopDialogShare}
      />
      <MetadataCleanupDialog {...workspace.cleanupDialogProps} />
      <DestructiveActionDialog {...workspace.removalDialogProps} />
      <AlbumMetadataDialog
        key={workspace.albumDialogProps.instanceKey}
        {...workspace.albumDialogProps}
      />
      {navigation.isMobile && navigation.drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/35 md:hidden"
          aria-hidden="true"
          onClick={navigation.closeDrawer}
        />
      )}
      {navigation.isMobile && !navigation.drawerOpen && (
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="fixed left-3 top-3 z-30 size-11 bg-background/95 shadow-sm md:hidden"
          aria-label="open library"
          onClick={(event) => navigation.openDrawer(event.currentTarget)}
        >
          <Menu />
        </Button>
      )}
      <div className="min-h-svh flex flex-col bg-background md:h-svh md:flex-row md:overflow-hidden">
        <TagSidebarPanel
          mobileOpen={navigation.drawerOpen}
          mobileDrawerRef={drawerRef}
          onMobileClose={navigation.closeDrawer}
          loading={busy}
          files={files}
          albums={albums}
          looseTrackIds={looseTrackIds}
          selectedAlbumId={selectedAlbumId}
          selectedFileId={selectedFileId}
          selectedFileIds={selectedFileIds}
          {...mobileSidebarProps}
          onAudioUpload={importing.commands.upload}
          onRetryDownload={importing.commands.retryTrack}
          onDownloadAlbum={(albumId) =>
            navigation.runAfterDrawerClose(() => exporting.downloadAlbum(albumId))
          }
          onShareAlbum={
            shareLinksEnabled
              ? (albumId) => navigation.runAfterDrawerClose(() => sharing.openCreator(albumId))
              : undefined
          }
          shareAlbumActions={shareLinksEnabled ? sharing.shareActions : undefined}
          onUploadToAlbum={(albumId, filesToUpload) =>
            importing.commands.upload(filesToUpload, albumId)
          }
          playlistDownloadQueue={importing.queue}
          onDownloadAll={() => navigation.runAfterDrawerClose(exporting.downloadAll)}
          onCancelPlaylistDownloadQueue={importing.commands.cancelQueue}
          onRetryPlaylistDownloadQueue={importing.commands.retryQueue}
        />
        <div
          className="relative order-1 flex-shrink-0 flex flex-col md:order-none md:min-h-0 md:flex-1"
          inert={navigation.isMobile && navigation.drawerOpen ? true : undefined}
        >
          <div
            className={
              landingIsActive
                ? "contents"
                : "h-svh min-h-0 flex flex-col overflow-hidden md:h-auto md:min-h-0 md:flex-1"
            }
          >
            {!libraryIsEmpty ? (
              <div className="relative min-h-0 flex-1">
                <div
                  data-view="metadata-editor"
                  aria-hidden={activeView !== "editor"}
                  inert={activeView !== "editor"}
                  className={`absolute inset-0 flex min-h-0 flex-col bg-background transition-opacity duration-200 motion-reduce:transition-none ${
                    activeView === "editor"
                      ? "z-10 opacity-100"
                      : "pointer-events-none z-0 opacity-0"
                  }`}
                >
                  <TrackMetadataEditor
                    selectedFile={editor.selectedFile}
                    selectedFileId={selectedFileId}
                    register={editor.form.register}
                    control={editor.form.control}
                    handleSubmit={editor.form.handleSubmit}
                    onTrackCoverUpload={editor.commands.uploadCover}
                    onTrackCoverProcessingChange={editor.commands.setCoverProcessing}
                    isTrackCoverProcessing={editor.isCoverProcessing}
                    onDownloadUpdatedFile={exporting.downloadTrack}
                    selectedFileAlbum={editor.selectedFileAlbum}
                    syncFilenames={settings.syncFilenames}
                    syncTrackNumbers={settings.syncTrackNumbers}
                    onPreviewMetadataChange={(field, event) =>
                      editor.commands.preview(field, event.target.value)
                    }
                    onAudioUpload={importing.commands.upload}
                  />
                </div>
                <div
                  data-view="settings"
                  aria-hidden={activeView !== "settings"}
                  inert={activeView !== "settings"}
                  className={`absolute inset-0 flex min-h-0 flex-col bg-background transition-opacity duration-200 motion-reduce:transition-none ${
                    activeView === "settings"
                      ? "z-10 opacity-100"
                      : "pointer-events-none z-0 opacity-0"
                  }`}
                >
                  <SettingsPage {...mobileSettingsProps} />
                </div>
              </div>
            ) : activeView === "settings" ? (
              <SettingsPage {...mobileSettingsProps} />
            ) : null}
          </div>
          <LandingScreen active={landingIsActive} onAudioUpload={importing.commands.upload}>
            {mediaUrlEntryPresentation?.layout === "landing" && (
              <MediaUrlEntry
                layout="landing"
                controller={mediaUrlEntryController}
                onUrlImport={handleUrlImport}
              />
            )}
          </LandingScreen>
          {mediaUrlEntryPresentation && mediaUrlEntryPresentation.layout !== "landing" && (
            <MediaUrlEntry
              layout={mediaUrlEntryPresentation.layout}
              controller={mediaUrlEntryController}
              onUrlImport={handleUrlImport}
            />
          )}
        </div>
      </div>
    </>
  );
}
