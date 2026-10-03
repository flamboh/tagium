import type { ReactNode } from "react";
import TrackMetadataEditor from "@/features/editor/TrackMetadataEditor";
import LandingScreen from "@/features/import/LandingScreen";
import MediaUrlEntry from "@/shared/media-url/MediaUrlEntry";
import { getMetadataLinkState } from "@/features/library/metadataLinks";
import SettingsPage from "@/features/settings/SettingsPage";
import { cn } from "@/lib/utils";
import type { AudioTaggerController } from "@/features/workspace/useAudioTaggerController";

type ColumnProps = {
  controller: AudioTaggerController;
  menuInTrackHeader: boolean;
  mobileMenuButton: ReactNode;
};

function AudioTaggerViews({ controller, menuInTrackHeader, mobileMenuButton }: ColumnProps) {
  const { library, editor, settings, activeView, importing, exporting, mobile, libraryIsEmpty } =
    controller;
  const { selectedFileId } = library.state;

  if (libraryIsEmpty) {
    return activeView === "settings" ? <SettingsPage {...mobile.settingsPageProps} /> : null;
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        data-view="metadata-editor"
        aria-hidden={activeView !== "editor"}
        inert={activeView !== "editor"}
        className={cn(
          "absolute inset-0 flex min-h-0 flex-col bg-background transition-opacity duration-200 motion-reduce:transition-none",
          activeView === "editor" ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0",
        )}
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
        className={cn(
          "absolute inset-0 flex min-h-0 flex-col bg-background transition-opacity duration-200 motion-reduce:transition-none",
          activeView === "settings" ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0",
        )}
      >
        <SettingsPage {...mobile.settingsPageProps} />
      </div>
    </div>
  );
}

export default function AudioTaggerMainColumn(props: ColumnProps) {
  const { controller } = props;
  const { mobile, landingIsActive, importing, mediaUrlEntryPresentation, mediaUrlEntryController } =
    controller;
  const mobileNavigation = mobile.navigation;

  return (
    <div
      className={cn(
        "page-enter [--page-enter-y:0px] relative order-1 flex-shrink-0 flex flex-col md:order-none md:min-h-0 md:flex-1",
        mobileNavigation.isMobile &&
          "transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-opacity",
        mobileNavigation.isMobile &&
          (mobileNavigation.drawerOpen ? "translate-x-[min(88vw,22rem)]" : "translate-x-0"),
      )}
    >
      {mobileNavigation.isMobile && (
        <div
          className={cn(
            "absolute inset-0 z-30 bg-black/25 transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-100",
            mobileNavigation.drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
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
        <AudioTaggerViews {...props} />
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
          />
        )}
      </LandingScreen>
    </div>
  );
}
