import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlaylistDownloadControllerSnapshot } from "@/features/import/playlistDownloadController";
import type { PlaylistDownloadQueuePanelState } from "@/features/import/PlaylistDownloadQueuePanel";
import { createAudioUploadSession } from "@/features/import/audioUploadSession";
import { createAudioUrlImportSession } from "@/features/import/audioUrlImportSession";
import { getImportQueuePresentation } from "@/features/import/importQueuePresentation";
import type { TrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AppSettings, ImportedAlbumMetadata } from "@/features/library/types";

type AudioImportEditor = {
  commands: Pick<TrackEditorSession["commands"], "flush" | "hydrateDownloadedTrack" | "updateTags">;
  form: Pick<TrackEditorSession["form"], "reset">;
};

export interface AudioImportSession {
  status: { uploading: boolean; urlImporting: boolean; importing: boolean };
  queue: PlaylistDownloadQueuePanelState | null;
  commands: {
    upload: (
      files: File[],
      targetAlbumId?: string,
      importedAlbum?: ImportedAlbumMetadata,
    ) => Promise<void>;
    importUrl: (sourceUrl: string) => Promise<void>;
    retryTrack: (fileId: string) => void;
    cancelQueue: () => void;
    retryQueue: () => void;
    removeTracks: (trackIds: string[]) => void;
  };
}

export const useAudioImportSession = ({
  library,
  editor,
  settings,
  activateEditor,
}: {
  library: LibraryStore;
  editor: AudioImportEditor;
  settings: AppSettings;
  activateEditor: () => void;
}): AudioImportSession => {
  const [uploading, setUploading] = useState(false);
  const [urlImporting, setUrlImporting] = useState(false);
  const [queueSnapshot, setQueueSnapshot] = useState<PlaylistDownloadControllerSnapshot | null>(
    null,
  );
  const editorRef = useRef(editor);
  const settingsRef = useRef(settings);
  const activateEditorRef = useRef(activateEditor);
  useLayoutEffect(() => {
    editorRef.current = editor;
    settingsRef.current = settings;
    activateEditorRef.current = activateEditor;
  }, [activateEditor, editor, settings]);

  const [uploadSession] = useState(() =>
    createAudioUploadSession({
      library,
      getSettings: () => settingsRef.current,
      bufferEditor: () => {
        editorRef.current.commands.flush();
      },
      activateEditor: () => activateEditorRef.current(),
      setUploading,
    }),
  );
  const [urlSession] = useState(() =>
    createAudioUrlImportSession({
      library,
      getEditor: () => editorRef.current.commands,
      resetEditorForm: (metadata) => editorRef.current.form.reset(metadata),
      getSettings: () => settingsRef.current,
      activateEditor: () => activateEditorRef.current(),
      setUrlImporting,
      emitQueueSnapshot: setQueueSnapshot,
    }),
  );
  const queue = useMemo(
    () => getImportQueuePresentation(queueSnapshot, library.state.files),
    [library.state.files, queueSnapshot],
  );

  return {
    status: { uploading, urlImporting, importing: uploading || urlImporting },
    queue,
    commands: {
      upload: uploadSession.upload,
      importUrl: urlSession.importUrl,
      retryTrack: urlSession.retryTrack,
      cancelQueue: urlSession.cancelQueue,
      retryQueue: urlSession.retryQueue,
      removeTracks: urlSession.removeTracks,
    },
  };
};
