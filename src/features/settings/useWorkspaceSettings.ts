import { useCallback, useLayoutEffect, useRef } from "react";
import { analytics } from "@/analytics";
import { saveAppSettings } from "@/features/settings/settings";
import { getMetadataLinkState } from "@/features/library/metadataLinks";
import type { SettingsPageProps } from "@/features/settings/SettingsPage";
import { reportSystemFailure } from "@/features/workspace/systemFailure";
import type { AppSettings } from "@/features/library/types";
import type { WorkspaceNavigation } from "@/features/workspace/workspaceNavigation";

export const useWorkspaceSettings = ({
  settings,
  setSettings,
  navigation,
}: {
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  navigation: Pick<WorkspaceNavigation, "goBack">;
}): SettingsPageProps => {
  const settingsRef = useRef(settings);
  useLayoutEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

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

  return { settings, onChange, onBack: navigation.goBack };
};
