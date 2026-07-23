"use client";

import { useCallback, useState } from "react";
import { ListMusic } from "lucide-react";
import { Button } from "@/components/ui/button";
import AlbumMetadataDialog from "@/features/editor/AlbumMetadataDialog";
import DestructiveActionDialog from "@/features/workspace/DestructiveActionDialog";
import LandingScreen from "@/features/import/LandingScreen";
import MediaUrlEntry from "@/features/import/MediaUrlEntry";
import MetadataCleanupDialog from "@/features/library/MetadataCleanupDialog";
import SettingsPage from "@/features/settings/SettingsPage";
import { getMetadataLinkState } from "@/features/library/metadataLinks";
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
import ExportConfirmationDialog from "@/features/export/ExportConfirmationDialog";
import { useLibraryStore } from "@/features/library/useLibraryStore";
import { useTrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { AppSettings } from "@/features/library/types";
import { useMobileWorkspaceNavigation } from "@/features/workspace/useMobileWorkspaceNavigation";
import { useDrawerSwipe } from "@/features/workspace/drawerSwipe";

export default function AudioTagger() {
  const library = useLibraryStore();
  const [activeView, setActiveView] = useState<ActiveView>("editor");
  const [settings, setSettings] = useState<AppSettings>(loadAppSettings);
  const activateEditor = useCallback(() => setActiveView("editor"), []);
  const editor = useTrackEditorSession({ library, settings });
  const exporting = useExportSession({ library, editor: editor.commands, settings });
  const importing = useAudioImportSession({
    library,
    editor,
    settings,
    activateEditor,
  });
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
  const { files, albums, looseTrackIds, selectedFileId, selectedAlbumId, selectedFileIds } =
    library.state;
  const libraryIsEmpty = files.length === 0 && albums.length === 0 && looseTrackIds.length === 0;
  const mobileNavigation = useMobileWorkspaceNavigation({
    libraryEmpty: libraryIsEmpty,
  });
  const { closeDrawer, isMobile } = mobileNavigation;
  const handoffMobileExport = useCallback(
    (startExport: () => void) => {
      if (!isMobile) {
        startExport();
        return;
      }

      // Let the drawer close and restore focus before the export dialog captures
      // its trigger. This keeps the trigger visible and outside the inert drawer.
      closeDrawer();
      requestAnimationFrame(startExport);
    },
    [closeDrawer, isMobile],
  );
  const startsInSwipeZone = useCallback(
    (touch: Touch, surface: HTMLElement) => {
      const bounds = surface.getBoundingClientRect();
      return mobileNavigation.drawerOpen
        ? touch.clientX >= Math.max(bounds.left, 48) &&
            touch.clientX <= Math.min(bounds.right, window.innerWidth - 20)
        : touch.clientX >= bounds.left + 48 &&
            touch.clientX <= bounds.left + bounds.width / 2 &&
            touch.clientY >= bounds.top + 64;
    },
    [mobileNavigation.drawerOpen],
  );
  const swipeSurfaceRef = useDrawerSwipe({
    enabled: mobileNavigation.isMobile,
    direction: mobileNavigation.drawerOpen ? "close" : "open",
    onCommit: mobileNavigation.drawerOpen
      ? mobileNavigation.closeDrawer
      : mobileNavigation.openDrawer,
    onSurfaceClick: mobileNavigation.drawerOpen ? mobileNavigation.closeDrawer : undefined,
    startsInZone: startsInSwipeZone,
  });
  const landingIsActive = libraryIsEmpty && activeView === "editor";
  const mediaUrlEntryPresentation = getMediaUrlEntryPresentation(
    libraryIsEmpty,
    activeView === "settings",
    Boolean(editor.selectedFile),
  );
  useBeforeUnloadProtection(
    hasRecoverableSessionWork({
      fileCount: files.length,
      albumCount: albums.length,
      importing: busy,
    }),
  );
  const mobilePresentation = !mobileNavigation.isMobile
    ? "library"
    : mobileNavigation.drawerOpen
      ? "drawer"
      : "hidden";
  const sidebarProps = {
    ...workspace.sidebarProps,
    onSelectFile: (...args: Parameters<typeof workspace.sidebarProps.onSelectFile>) => {
      workspace.sidebarProps.onSelectFile(...args);
      mobileNavigation.closeDrawer();
    },
    onSelectLooseTrack: (...args: Parameters<typeof workspace.sidebarProps.onSelectLooseTrack>) => {
      workspace.sidebarProps.onSelectLooseTrack(...args);
      mobileNavigation.closeDrawer();
    },
    onOpenSettings: () => {
      workspace.sidebarProps.onOpenSettings();
      mobileNavigation.closeDrawer();
    },
  };

  return (
    <>
      <MetadataCleanupDialog {...workspace.cleanupDialogProps} />
      <DestructiveActionDialog {...workspace.removalDialogProps} />
      <AlbumMetadataDialog {...workspace.albumDialogProps} />
      <ExportConfirmationDialog
        summary={exporting.confirmation}
        status={exporting.confirmationStatus}
        busy={exporting.exporting}
        onCancel={exporting.cancelConfirmation}
        onConfirm={() => void exporting.confirmDownload()}
        onRestoreFocus={exporting.restoreConfirmationFocus}
      />
      <div
        className="relative h-svh min-h-svh overflow-hidden bg-background [--mobile-drawer-width:min(20rem,88vw)] md:flex md:flex-row"
        data-mobile-drawer={mobileNavigation.drawerOpen ? "open" : "closed"}
      >
        <TagSidebarPanel
          loading={busy}
          files={files}
          albums={albums}
          looseTrackIds={looseTrackIds}
          selectedAlbumId={selectedAlbumId}
          selectedFileId={selectedFileId}
          selectedFileIds={selectedFileIds}
          {...sidebarProps}
          mobilePresentation={mobilePresentation}
          onCloseMobileDrawer={mobileNavigation.closeDrawer}
          onAudioUpload={importing.commands.upload}
          onRetryDownload={importing.commands.retryTrack}
          onDownloadAlbum={(albumId) => handoffMobileExport(() => exporting.downloadAlbum(albumId))}
          onUploadToAlbum={(albumId, filesToUpload) =>
            importing.commands.upload(filesToUpload, albumId)
          }
          playlistDownloadQueue={importing.queue}
          onDownloadAll={() => handoffMobileExport(exporting.downloadAll)}
          onCancelPlaylistDownloadQueue={importing.commands.cancelQueue}
          onRetryPlaylistDownloadQueue={importing.commands.retryQueue}
        />
        <div
          data-mobile-main-surface=""
          ref={swipeSurfaceRef}
          className={`relative flex h-svh w-full shrink-0 flex-col transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none md:min-h-0 md:min-w-0 md:flex-1 md:shrink md:translate-x-0 md:transition-none ${
            mobileNavigation.drawerOpen
              ? "translate-x-[var(--mobile-drawer-width)]"
              : "translate-x-0"
          }`}
        >
          <div
            className={`flex h-full w-full flex-col ${
              mobileNavigation.drawerOpen ? "pointer-events-none" : ""
            }`}
            data-mobile-main-content=""
            aria-hidden={
              mobileNavigation.isMobile && mobileNavigation.drawerOpen ? true : undefined
            }
            inert={mobileNavigation.isMobile && mobileNavigation.drawerOpen ? true : undefined}
          >
            {mobileNavigation.isMobile && (
              <div
                data-mobile-opener-layer=""
                className={
                  landingIsActive
                    ? "absolute inset-x-0 top-0 z-20 h-14 border-b bg-background md:hidden"
                    : "absolute left-2 top-2 z-20 size-11 transform-gpu md:hidden"
                }
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={
                    landingIsActive ? "absolute left-2 top-2 z-20 size-11 md:hidden" : "size-11"
                  }
                  onClick={mobileNavigation.openDrawer}
                  aria-label="open library"
                  aria-expanded={mobileNavigation.drawerOpen}
                  aria-controls="tagium-library"
                >
                  <ListMusic className="size-5" />
                </Button>
              </div>
            )}
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
                      getValues={editor.form.getValues}
                      setError={editor.form.setError}
                      clearErrors={editor.form.clearErrors}
                      setFocus={editor.form.setFocus}
                      onTrackCoverUpload={editor.commands.uploadCover}
                      onTrackCoverProcessingChange={editor.commands.setCoverProcessing}
                      isTrackCoverProcessing={editor.isCoverProcessing}
                      onDownloadUpdatedFile={exporting.downloadTrack}
                      selectedFileAlbum={editor.selectedFileAlbum}
                      syncFilenames={settings.syncFilenames}
                      advancedMetadata={settings.advancedMetadata}
                      metadataLinks={getMetadataLinkState(settings)}
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
                    <SettingsPage
                      {...workspace.settingsPageProps}
                      onBack={workspace.settingsPageProps.onBack}
                    />
                  </div>
                </div>
              ) : activeView === "settings" ? (
                <SettingsPage
                  {...workspace.settingsPageProps}
                  onBack={workspace.settingsPageProps.onBack}
                />
              ) : null}
            </div>
            <LandingScreen active={landingIsActive} onAudioUpload={importing.commands.upload}>
              {mediaUrlEntryPresentation && (
                <MediaUrlEntry
                  layout={mediaUrlEntryPresentation.layout}
                  onUrlImport={importing.commands.importUrl}
                />
              )}
            </LandingScreen>
          </div>
        </div>
      </div>
    </>
  );
}
