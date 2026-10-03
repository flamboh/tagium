import AlbumMetadataDialog from "@/features/editor/AlbumMetadataDialog";
import DestructiveActionDialog from "@/features/workspace/DestructiveActionDialog";
import MetadataCleanupDialog from "@/features/library/MetadataCleanupDialog";
import ExportConfirmationDialog from "@/features/export/ExportConfirmationDialog";
import ShareAlbumDialog from "@/features/share/ShareAlbumDialog";
import type { AudioTaggerController } from "@/features/workspace/useAudioTaggerController";

export default function AudioTaggerDialogs({ controller }: { controller: AudioTaggerController }) {
  const { sharing, workspace, exporting } = controller;

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
    </>
  );
}
