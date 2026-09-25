import TagSidebarPanel from "@/features/library/TagSidebarPanel";
import { shareLinksEnabled } from "@/features/share/shareFeature";
import type { AudioTaggerController } from "@/features/workspace/useAudioTaggerController";

const EMPTY_SELECTION = new Set<string>();

export default function AudioTaggerSidebar({ controller }: { controller: AudioTaggerController }) {
  const {
    library,
    editor,
    activeView,
    importing,
    exporting,
    sharing,
    busy,
    mobile,
    shareAlbumActions,
    shareTrackActions,
    shareSpotlight,
  } = controller;
  const { files, albums, looseTrackIds, selectedFileId, selectedAlbumId, selectedFileIds } =
    library.state;
  const { navigation: mobileNavigation, runPrimaryAction, drawerRef, sidebarProps } = mobile;

  return (
    <TagSidebarPanel
      mobileOpen={mobileNavigation.drawerOpen}
      mobileDrawerRef={drawerRef}
      onMobileClose={mobileNavigation.closeDrawer}
      loading={busy}
      files={files}
      filenamePreviewStore={editor.filenamePreviewStore}
      albums={albums}
      looseTrackIds={looseTrackIds}
      selectedAlbumId={activeView === "settings" ? null : selectedAlbumId}
      selectedFileId={activeView === "settings" ? null : selectedFileId}
      selectedFileIds={activeView === "settings" ? EMPTY_SELECTION : selectedFileIds}
      {...sidebarProps}
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
      shareAlbumActions={shareAlbumActions}
      onShareTrack={
        shareLinksEnabled
          ? (fileId) =>
              mobileNavigation.runAfterDrawerClose(() => {
                void sharing.openCreator({ kind: "track", id: fileId });
              })
          : undefined
      }
      shareTrackActions={shareTrackActions}
      shareSpotlight={shareSpotlight.target}
      onShareSpotlightDismiss={shareSpotlight.dismiss}
      onUploadToAlbum={(albumId, filesToUpload) =>
        runPrimaryAction(() => void importing.commands.upload(filesToUpload, albumId))
      }
      playlistDownloadQueue={importing.queue}
      onDownloadAll={() => mobileNavigation.runAfterDrawerClose(exporting.downloadAll)}
      onCancelPlaylistDownloadQueue={importing.commands.cancelQueue}
      onRetryPlaylistDownloadQueue={importing.commands.retryQueue}
    />
  );
}
