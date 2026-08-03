import { useCallback, useLayoutEffect, useRef } from "react";
import { analytics } from "@/analytics";
import { saveAppSettings } from "@/features/settings/settings";
import { getMetadataLinkState } from "@/features/library/metadataLinks";
import type { SettingsPageProps } from "@/features/settings/SettingsPage";
import { reportSystemFailure } from "@/features/workspace/systemFailure";
import type { TrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AppSettings } from "@/features/library/types";
import type { SetActiveView } from "@/features/workspace/audioWorkspaceTypes";

type SettingsEditor = Pick<TrackEditorSession, "isCoverProcessing">;

export const useWorkspaceSettings = ({
  editor,
  settings,
  setSettings,
  setActiveView,
}: {
  library: LibraryStore;
  editor: SettingsEditor;
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  setActiveView: SetActiveView;
}): SettingsPageProps => {
  const editorRef = useRef(editor);
  const settingsRef = useRef(settings);
  useLayoutEffect(() => {
    editorRef.current = editor;
    settingsRef.current = settings;
  }, [editor, settings]);

  const onChange = useCallback(
    (nextSettings: AppSettings) => {
      const previous = settingsRef.current;
      const changed =
        previous.syncTrackNumbers !== nextSettings.syncTrackNumbers ||
        previous.syncFilenames !== nextSettings.syncFilenames ||
        previous.audioBitrate !== nextSettings.audioBitrate ||
        previous.applySoundCloudAlbumCoverToTracks !==
          nextSettings.applySoundCloudAlbumCoverToTracks ||
        previous.advancedMetadata !== nextSettings.advancedMetadata ||
        Object.keys(previous.metadataLinks).some(
          (key) =>
            previous.metadataLinks[key as keyof typeof previous.metadataLinks] !==
            nextSettings.metadataLinks[key as keyof typeof nextSettings.metadataLinks],
        );
      const saved = saveAppSettings(nextSettings);
      setSettings(nextSettings);
      settingsRef.current = nextSettings;
      if (!saved && changed) {
        reportSystemFailure(new Error("settings storage unavailable"), "storage");
      }
      if (saved && changed) {
        analytics.capture({
          type: "settings_changed",
          syncFilenames: nextSettings.syncFilenames,
          audioBitrate: nextSettings.audioBitrate,
          applySoundCloudCover: nextSettings.applySoundCloudAlbumCoverToTracks,
          advancedMetadata: nextSettings.advancedMetadata,
          metadataLinks: getMetadataLinkState(nextSettings),
        });
      }
    },
    [setSettings],
  );

  const onBack = useCallback(() => {
    if (!editorRef.current.isCoverProcessing) {
      setActiveView((current) => (current === "settings" ? "editor" : "settings"));
    }
  }, [setActiveView]);

  return { settings, onChange, onBack };
};
