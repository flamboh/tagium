"use client";

import { useCallback, useState } from "react";
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
      <div className="min-h-svh flex flex-col bg-background md:h-svh md:flex-row md:overflow-hidden">
        <TagSidebarPanel
          loading={busy}
          files={files}
          albums={albums}
          looseTrackIds={looseTrackIds}
          selectedAlbumId={selectedAlbumId}
          selectedFileId={selectedFileId}
          selectedFileIds={selectedFileIds}
          {...workspace.sidebarProps}
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
        <div className="relative order-1 flex-shrink-0 flex flex-col md:order-none md:min-h-0 md:flex-1">
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
                  <SettingsPage {...workspace.settingsPageProps} />
                </div>
              </div>
            ) : activeView === "settings" ? (
              <SettingsPage {...workspace.settingsPageProps} />
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
