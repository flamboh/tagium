"use client";

import { useState } from "react";
import { Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import AlbumMetadataDialog from "@/features/editor/AlbumMetadataDialog";
import DestructiveActionDialog from "@/features/workspace/DestructiveActionDialog";
import LandingScreen from "@/features/import/LandingScreen";
import MediaUrlEntry, { useMediaUrlEntryController } from "@/features/import/MediaUrlEntry";
import MetadataCleanupDialog from "@/features/library/MetadataCleanupDialog";
import { getMetadataLinkState } from "@/features/library/metadataLinks";
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
import { useAudioWorkspace } from "@/features/workspace/useAudioWorkspace";
import { useExportSession } from "@/features/export/useExportSession";
import ExportConfirmationDialog from "@/features/export/ExportConfirmationDialog";
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
import { useAudioTaggerMobileNavigation } from "@/features/workspace/useAudioTaggerMobileNavigation";
import { useWorkspaceNavigation } from "@/features/workspace/workspaceNavigation";

const EMPTY_SELECTION = new Set<string>();

export default function AudioTagger() {
  const library = useLibraryStore();
  const [settings, setSettings] = useState<AppSettings>(loadAppSettings);
  const editor = useTrackEditorSession({ library, settings });
  const workspaceNavigation = useWorkspaceNavigation({ library, editor });
  const activeView = workspaceNavigation.activeView;
  const activateEditor = workspaceNavigation.showEditor;
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
    navigation: workspaceNavigation,
    removeDownloads: importing.commands.removeTracks,
    busy,
  });
  const {
    navigation: mobileNavigation,
    runPrimaryAction,
    drawerRef,
    menuButtonRef,
    sidebarProps: mobileSidebarProps,
    settingsPageProps: mobileSettingsProps,
  } = useAudioTaggerMobileNavigation({ navigation: workspaceNavigation, workspace });
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
  const menuInTrackHeader =
    mobileNavigation.isMobile && activeView === "editor" && Boolean(editor.selectedFile);
  const mobileMenuButton = mobileNavigation.isMobile ? (
    <Button
      ref={menuButtonRef}
      type="button"
      size="icon"
      variant="outline"
      className={`size-11 bg-background/95 shadow-sm md:hidden ${mobileNavigation.drawerOpen ? "pointer-events-none opacity-0" : ""}`}
      tabIndex={mobileNavigation.drawerOpen ? -1 : 0}
      aria-label="open library"
      data-export-focus-fallback
      onClick={(event) => mobileNavigation.openDrawer(event.currentTarget)}
    >
      <HugeiconsIcon icon={Menu01Icon} strokeWidth={2} />
    </Button>
  ) : null;

  if (shareLinksEnabled && sharing.page) {
    return (
      <SharedAlbumPage
        state={sharing.page}
        workspaceTrackCount={files.length}
        anotherTabOpen={sharing.anotherTabOpen}
        alreadyAddedTargetId={sharing.alreadyAddedTargetId}
        adding={sharing.adding}
        canStopSharing={sharing.canStopSharing}
        onBack={sharing.back}
        onOpenTagium={sharing.openTagium}
        onAdd={sharing.addSharedContent}
        onViewAdded={sharing.viewAlreadyAdded}
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
      <DestructiveActionDialog {...workspace.albumDeletionDialogProps} />
      <AlbumMetadataDialog
        key={workspace.albumDialogProps.instanceKey}
        {...workspace.albumDialogProps}
      />
      <ExportConfirmationDialog
        plan={exporting.confirmation}
        status={exporting.confirmationStatus}
        busy={exporting.exporting}
        onCancel={exporting.cancelConfirmation}
        onConfirm={() => void exporting.confirmDownload()}
        onRestoreFocus={exporting.restoreConfirmationFocus}
      />
      {mobileMenuButton && !menuInTrackHeader && (
        <div className="fixed left-3 top-3 z-30 md:hidden">{mobileMenuButton}</div>
      )}
      <div className="min-h-svh touch-pan-y flex flex-col overflow-x-hidden bg-background md:h-svh md:touch-auto md:flex-row md:overflow-hidden">
        <TagSidebarPanel
          mobileOpen={mobileNavigation.drawerOpen}
          mobileDrawerRef={drawerRef}
          onMobileClose={mobileNavigation.closeDrawer}
          loading={busy}
          files={files}
          albums={albums}
          looseTrackIds={looseTrackIds}
          selectedAlbumId={activeView === "settings" ? null : selectedAlbumId}
          selectedFileId={activeView === "settings" ? null : selectedFileId}
          selectedFileIds={activeView === "settings" ? EMPTY_SELECTION : selectedFileIds}
          {...mobileSidebarProps}
          onAudioUpload={(filesToUpload) =>
            runPrimaryAction(() => void importing.commands.upload(filesToUpload))
          }
          onRetryDownload={importing.commands.retryTrack}
          onDownloadAlbum={(albumId) =>
            mobileNavigation.runAfterDrawerClose(() => exporting.downloadAlbum(albumId))
          }
          onShareAlbum={
            shareLinksEnabled
              ? (albumId) =>
                  mobileNavigation.runAfterDrawerClose(() => {
                    void sharing.openCreator({ kind: "album", id: albumId });
                  })
              : undefined
          }
          shareAlbumActions={shareLinksEnabled ? sharing.shareActions : undefined}
          onShareTrack={
            shareLinksEnabled
              ? (fileId) =>
                  mobileNavigation.runAfterDrawerClose(() => {
                    void sharing.openCreator({ kind: "track", id: fileId });
                  })
              : undefined
          }
          shareTrackActions={shareLinksEnabled ? sharing.shareTrackActions : undefined}
          onUploadToAlbum={(albumId, filesToUpload) =>
            runPrimaryAction(() => void importing.commands.upload(filesToUpload, albumId))
          }
          playlistDownloadQueue={importing.queue}
          onDownloadAll={() => mobileNavigation.runAfterDrawerClose(exporting.downloadAll)}
          onCancelPlaylistDownloadQueue={importing.commands.cancelQueue}
          onRetryPlaylistDownloadQueue={importing.commands.retryQueue}
        />
        <div
          className={`relative order-1 flex-shrink-0 flex flex-col md:order-none md:min-h-0 md:flex-1 ${mobileNavigation.isMobile ? "transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-opacity" : ""} ${mobileNavigation.isMobile && mobileNavigation.drawerOpen ? "translate-x-[min(88vw,22rem)]" : mobileNavigation.isMobile ? "translate-x-0" : ""}`}
        >
          {mobileNavigation.isMobile && (
            <div
              className={`absolute inset-0 z-30 bg-black/25 transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-100 ${mobileNavigation.drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
              aria-hidden="true"
              onClick={mobileNavigation.closeDrawer}
            />
          )}
          <div
            className={
              landingIsActive
                ? "contents"
                : "h-svh min-h-0 flex flex-col overflow-hidden md:h-auto md:min-h-0 md:flex-1"
            }
            inert={mobileNavigation.isMobile && mobileNavigation.drawerOpen ? true : undefined}
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
                    viewActive={activeView === "editor"}
                    headerLeadingAction={menuInTrackHeader ? mobileMenuButton : undefined}
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
                  <SettingsPage {...mobileSettingsProps} />
                </div>
              </div>
            ) : activeView === "settings" ? (
              <SettingsPage {...mobileSettingsProps} />
            ) : null}
          </div>
          <LandingScreen
            active={landingIsActive}
            inert={mobileNavigation.isMobile && mobileNavigation.drawerOpen}
            onAudioUpload={importing.commands.upload}
          >
            {mediaUrlEntryPresentation && (
              <MediaUrlEntry
                layout={mediaUrlEntryPresentation.layout}
                controller={mediaUrlEntryController}
                onUrlImport={handleUrlImport}
              />
            )}
          </LandingScreen>
        </div>
      </div>
    </>
  );
}
