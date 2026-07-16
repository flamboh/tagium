import { useCallback, useLayoutEffect, useRef } from "react";
import { analytics } from "@/src/analytics";
import { applySyncedFilenamesToFiles, applyTrackOrderNumbersToFiles } from "./fileMetadataOps";
import { saveAppSettings } from "./settings";
import type { SettingsPageProps } from "./SettingsPage";
import { reportSystemFailure } from "./systemFailure";
import type { TrackEditorSession } from "./useTrackEditorSession";
import type { LibraryStore } from "./useLibraryStore";
import type { AppSettings } from "./types";
import type { SetActiveView } from "./audioWorkspaceTypes";

type SettingsEditor = Pick<TrackEditorSession, "isCoverProcessing">;

export const useWorkspaceSettings = ({
  library,
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
          nextSettings.applySoundCloudAlbumCoverToTracks;
      const saved = saveAppSettings(nextSettings);
      setSettings(nextSettings);
      settingsRef.current = nextSettings;
      if (!saved && changed) {
        reportSystemFailure(new Error("settings storage unavailable"), "storage");
      }
      if (saved && changed) {
        analytics.capture({
          type: "settings_changed",
          syncTrackNumbers: nextSettings.syncTrackNumbers,
          syncFilenames: nextSettings.syncFilenames,
          audioBitrate: nextSettings.audioBitrate,
          applySoundCloudCover: nextSettings.applySoundCloudAlbumCoverToTracks,
        });
      }
      const snapshot = library.getSnapshot();
      let syncedFiles = snapshot.files;
      if (!previous.syncTrackNumbers && nextSettings.syncTrackNumbers) {
        syncedFiles = applyTrackOrderNumbersToFiles(
          syncedFiles,
          snapshot.albums,
          snapshot.albums.map((album) => album.id),
        );
      }
      if (!previous.syncFilenames && nextSettings.syncFilenames) {
        syncedFiles = applySyncedFilenamesToFiles(syncedFiles);
      }
      if (syncedFiles !== snapshot.files) {
        library.dispatch({ type: "content-replaced", files: syncedFiles });
      }
    },
    [library, setSettings],
  );

  const onBack = useCallback(() => {
    if (!editorRef.current.isCoverProcessing) {
      setActiveView((current) => (current === "settings" ? "editor" : "settings"));
    }
  }, [setActiveView]);

  return { settings, onChange, onBack };
};
