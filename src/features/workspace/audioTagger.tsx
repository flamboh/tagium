"use client";

import { useCallback, useState } from "react";
import AlbumMetadataDialog from "@/features/editor/AlbumMetadataDialog";
import DestructiveActionDialog from "@/features/workspace/DestructiveActionDialog";
import LandingScreen from "@/features/import/LandingScreen";
import MediaUrlEntry from "@/features/import/MediaUrlEntry";
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

  const handleUrlImport = async (sourceUrl: string) => {
    const classification = classifyShareLink(sourceUrl);
    if (classification.kind === "invalid-share") throw new InvalidShareLinkError();
    if (classification.kind === "share" && !shareLinksEnabled) throw new ShareLinksDisabledError();
    if (classification.kind === "share") {
      await sharing.openFromInput(classification.slug);
      return;
    }
    await importing.commands.importUrl(sourceUrl);
  };

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
          onShareAlbum={shareLinksEnabled ? sharing.openCreator : undefined}
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
              onUrlImport={handleUrlImport}
              getSubmissionLabel={(sourceUrl) =>
                classifyShareLink(sourceUrl).kind === "share"
                  ? "opening shared album…"
                  : "importing media…"
              }
            />
          </LandingScreen>
        </div>
      </div>
    </>
  );
}
