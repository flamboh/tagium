"use client";

import { Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import SharedAlbumPage from "@/features/share/SharedAlbumPage";
import { shareLinksEnabled } from "@/features/share/shareFeature";
import { cn } from "@/lib/utils";
import AudioTaggerDialogs from "@/features/workspace/AudioTaggerDialogs";
import AudioTaggerMainColumn from "@/features/workspace/AudioTaggerMainColumn";
import AudioTaggerSidebar from "@/features/workspace/AudioTaggerSidebar";
import { useAudioTaggerController } from "@/features/workspace/useAudioTaggerController";

export default function AudioTagger() {
  const controller = useAudioTaggerController();
  const { library, editor, activeView, sharing, mobile } = controller;
  const { navigation: mobileNavigation, menuButtonRef } = mobile;
  const menuInTrackHeader =
    mobileNavigation.isMobile && activeView === "editor" && Boolean(editor.selectedFile);
  const mobileMenuButton = mobileNavigation.isMobile ? (
    <Button
      ref={menuButtonRef}
      type="button"
      size="icon"
      variant="outline"
      className={cn(
        "size-11 bg-background/95 shadow-sm md:hidden",
        mobileNavigation.drawerOpen && "pointer-events-none opacity-0",
      )}
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
      <div className="page-enter">
        <SharedAlbumPage
          state={sharing.page}
          workspaceTrackCount={library.state.files.length}
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
      </div>
    );
  }

  return (
    <>
      <AudioTaggerDialogs controller={controller} />
      {mobileMenuButton && !menuInTrackHeader && (
        <div className="fixed left-3 top-3 z-30 md:hidden">{mobileMenuButton}</div>
      )}
      <div className="min-h-svh touch-pan-y flex flex-col overflow-x-hidden bg-background md:h-svh md:touch-auto md:flex-row md:overflow-hidden">
        <AudioTaggerSidebar controller={controller} />
        <AudioTaggerMainColumn
          controller={controller}
          menuInTrackHeader={menuInTrackHeader}
          mobileMenuButton={mobileMenuButton}
        />
      </div>
    </>
  );
}
