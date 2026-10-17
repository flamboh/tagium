import { Effect } from "effect";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyDetectedTrackTagsToFiles } from "@/features/library/fileMetadataOps";
import { createTrackFillQueue, type TrackFillQueue } from "@/features/library/trackFillQueue";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import { getLyricsQuery, lookupLyrics, type LyricsLookup } from "@/features/lyrics/lyricsLookup";

const LOOKUP_SPACING = "300 millis";

const noPendingTracks: ReadonlySet<string> = new Set();

type LyricsTrack = TagiumFile & { metadata: AudioMetadata };

const isReadyForLyrics = (file: TagiumFile | undefined): file is LyricsTrack =>
  Boolean(file?.metadata && file.downloadStatus === "ready" && file.status !== "error");

const needsLyrics = (file: LyricsTrack) =>
  file.metadata.lyrics === "" &&
  file.metadata.title.trim() !== "" &&
  file.metadata.artist.trim() !== "";

export const createTrackLyricsQueue = ({
  library,
  getCurrentFiles = () => library.getSnapshot().files,
  getSettings,
  isExportRunning,
  lookup,
  onPendingChange,
}: {
  library: Pick<LibraryStore, "getSnapshot" | "dispatch">;
  getCurrentFiles?: () => TagiumFile[];
  getSettings: () => Pick<AppSettings, "findLyrics">;
  isExportRunning: () => boolean;
  lookup: (metadata: AudioMetadata, signal: AbortSignal) => Promise<LyricsLookup>;
  onPendingChange: (trackIds: ReadonlySet<string>) => void;
}): TrackFillQueue =>
  createTrackFillQueue({
    library,
    getCurrentFiles,
    isEnabled: () => getSettings().findLyrics,
    isExportRunning,
    isReady: isReadyForLyrics,
    needsFill: needsLyrics,
    inputKey: (file) => JSON.stringify(getLyricsQuery(file.metadata)),
    run: (file, signal) => lookup(file.metadata, signal),
    apply: (files, trackId, result) =>
      result.status === "found"
        ? applyDetectedTrackTagsToFiles(files, trackId, { lyrics: result.lyrics })
        : files,
    onPendingChange,
  });

export const useTrackLyrics = ({
  library,
  projectFiles,
  settings,
  exporting,
  isExportRunning,
}: {
  library: LibraryStore;
  projectFiles: () => TagiumFile[];
  settings: AppSettings;
  exporting: boolean;
  isExportRunning: () => boolean;
}) => {
  const [pendingTrackIds, setPendingTrackIds] = useState(noPendingTracks);
  const settingsRef = useRef(settings);
  const queueRef = useRef<TrackFillQueue | null>(null);
  const isExportRunningRef = useRef(isExportRunning);
  const projectFilesRef = useRef(projectFiles);
  useLayoutEffect(() => {
    settingsRef.current = settings;
    isExportRunningRef.current = isExportRunning;
    projectFilesRef.current = projectFiles;
  }, [isExportRunning, projectFiles, settings]);

  const { getSnapshot, dispatch } = library;
  useEffect(() => {
    const queue = createTrackLyricsQueue({
      library: { getSnapshot, dispatch },
      getCurrentFiles: () => projectFilesRef.current(),
      getSettings: () => settingsRef.current,
      isExportRunning: () => isExportRunningRef.current(),
      lookup: (metadata, signal) =>
        Effect.runPromise(
          lookupLyrics(getLyricsQuery(metadata)).pipe(
            Effect.ensuring(Effect.sleep(LOOKUP_SPACING)),
          ),
          { signal },
        ),
      onPendingChange: setPendingTrackIds,
    });

    queueRef.current = queue;

    return () => {
      queue.dispose();
      queueRef.current = null;
    };
  }, [dispatch, getSnapshot]);

  useEffect(() => {
    queueRef.current?.sync();
  }, [exporting, library.state.files, settings.findLyrics]);

  return { pendingTrackIds };
};
