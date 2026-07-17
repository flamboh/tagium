"use client";

import { useCallback, useState } from "react";
import { ArrowLeft, ListMusic } from "lucide-react";
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
    selectedFileId,
    settingsOpen: activeView === "settings",
    libraryEmpty: libraryIsEmpty,
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
    : mobileNavigation.page === "library"
      ? "library"
      : mobileNavigation.sheetOpen
        ? "sheet"
        : "hidden";
  const sidebarProps = {
    ...workspace.sidebarProps,
    onSelectFile: (...args: Parameters<typeof workspace.sidebarProps.onSelectFile>) => {
      workspace.sidebarProps.onSelectFile(...args);
      const trigger = args[2]?.currentTarget;
      mobileNavigation.openEditor("editor", trigger instanceof HTMLElement ? trigger : null);
    },
    onSelectLooseTrack: (...args: Parameters<typeof workspace.sidebarProps.onSelectLooseTrack>) => {
      workspace.sidebarProps.onSelectLooseTrack(...args);
      const trigger = args[1]?.currentTarget;
      mobileNavigation.openEditor("editor", trigger instanceof HTMLElement ? trigger : null);
    },
    onOpenSettings: () => {
      workspace.sidebarProps.onOpenSettings();
      mobileNavigation.openEditor("settings");
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
        className="relative h-svh min-h-svh overflow-hidden bg-background md:flex md:flex-row"
        data-mobile-page={mobileNavigation.page}
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
          onCloseMobileSheet={mobileNavigation.closeSheet}
          onAudioUpload={importing.commands.upload}
          onRetryDownload={importing.commands.retryTrack}
          onDownloadAlbum={exporting.downloadAlbum}
          onUploadToAlbum={(albumId, filesToUpload) =>
            importing.commands.upload(filesToUpload, albumId)
          }
          playlistDownloadQueue={importing.queue}
          onDownloadAll={exporting.downloadAll}
          onCancelPlaylistDownloadQueue={importing.commands.cancelQueue}
          onRetryPlaylistDownloadQueue={importing.commands.retryQueue}
        />
        {mobileNavigation.isMobile && mobileNavigation.sheetOpen && (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/45 motion-reduce:transition-none md:hidden"
            onClick={mobileNavigation.closeSheet}
            aria-label="close library"
            tabIndex={-1}
          />
        )}
        <div
          className="relative flex h-svh min-w-0 flex-1 flex-col md:min-h-0"
          aria-hidden={
            mobileNavigation.isMobile &&
            (mobileNavigation.page === "library" || mobileNavigation.sheetOpen)
              ? true
              : undefined
          }
          inert={
            mobileNavigation.isMobile &&
            (mobileNavigation.page === "library" || mobileNavigation.sheetOpen)
              ? true
              : undefined
          }
        >
          {mobileNavigation.isMobile && landingIsActive && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute left-3 top-3 z-20 size-10 bg-background"
              onClick={mobileNavigation.openSheet}
              aria-label="open library"
              aria-expanded={mobileNavigation.sheetOpen}
              data-mobile-workspace-destination="editor"
            >
              <ListMusic className="size-5" />
            </Button>
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
                  <div className="flex h-12 shrink-0 items-center justify-between border-b px-2 md:hidden">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 px-2"
                      onClick={mobileNavigation.backToLibrary}
                      data-mobile-workspace-destination="editor"
                    >
                      <ArrowLeft className="size-4" />
                      library
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      onClick={mobileNavigation.openSheet}
                      aria-label="open library"
                      aria-expanded={mobileNavigation.sheetOpen}
                    >
                      <ListMusic className="size-5" />
                    </Button>
                  </div>
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
                    onBack={
                      mobileNavigation.isMobile
                        ? () => {
                            workspace.settingsPageProps.onBack();
                            mobileNavigation.backToLibrary();
                          }
                        : workspace.settingsPageProps.onBack
                    }
                  />
                </div>
              </div>
            ) : activeView === "settings" ? (
              <SettingsPage
                {...workspace.settingsPageProps}
                onBack={
                  mobileNavigation.isMobile
                    ? () => {
                        workspace.settingsPageProps.onBack();
                        mobileNavigation.backToLibrary();
                      }
                    : workspace.settingsPageProps.onBack
                }
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
    </>
  );
}
