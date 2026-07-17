"use client";

import { useCallback, useEffect, useState } from "react";
import AlbumMetadataDialog from "./AlbumMetadataDialog";
import DestructiveActionDialog from "./DestructiveActionDialog";
import LandingScreen from "./LandingScreen";
import MediaUrlEntry from "./MediaUrlEntry";
import MetadataCleanupDialog from "./MetadataCleanupDialog";
import SettingsPage from "./SettingsPage";
import TagSidebarPanel from "./TagSidebarPanel";
import TrackMetadataEditor from "./TrackMetadataEditor";
import { getMediaUrlEntryPresentation } from "./mediaUrlEntryPresentation";
import { hasRecoverableSessionWork, useBeforeUnloadProtection } from "./sessionSafety";
import { loadAppSettings } from "./settings";
import { useAudioImportSession } from "./useAudioImportSession";
import { useAudioWorkspace, type ActiveView } from "./useAudioWorkspace";
import { useExportSession } from "./useExportSession";
import { useLibraryStore } from "./useLibraryStore";
import { useTrackEditorSession } from "./useTrackEditorSession";
import type { AppSettings } from "./types";

export default function AudioTagger() {
  const library = useLibraryStore();
  const [activeView, setActiveView] = useState<ActiveView>("editor");
  const [settings, setSettings] = useState<AppSettings>(loadAppSettings);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.classList.toggle("dark", settings.theme === "signal");
  }, [settings.theme]);
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
            <MediaUrlEntry
              layout={mediaUrlEntryPresentation.layout}
              hidden={mediaUrlEntryPresentation.hidden}
              docked={mediaUrlEntryPresentation.docked}
              onUrlImport={importing.commands.importUrl}
            />
          </LandingScreen>
        </div>
      </div>
    </>
  );
}
