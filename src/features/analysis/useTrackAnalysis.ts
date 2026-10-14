import { Effect } from "effect";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { analyzeTrack } from "@/features/analysis/analyzeTrack";
import {
  createTrackAnalysisQueue,
  type TrackAnalysisQueue,
} from "@/features/analysis/trackAnalysisQueue";
import type { AppSettings } from "@/features/library/types";
import type { LibraryStore } from "@/features/library/useLibraryStore";

const noPendingTracks: ReadonlySet<string> = new Set();

/** Detects tempo and key for library tracks while the dj analysis setting is on. */
export const useTrackAnalysis = ({
  library,
  settings,
  exporting,
  isExportRunning,
}: {
  library: LibraryStore;
  settings: AppSettings;
  /** Rerenders when an export finishes, so results held during it are applied. */
  exporting: boolean;
  isExportRunning: () => boolean;
}) => {
  const [pendingTrackIds, setPendingTrackIds] = useState(noPendingTracks);
  const settingsRef = useRef(settings);
  const queueRef = useRef<TrackAnalysisQueue | null>(null);
  const isExportRunningRef = useRef(isExportRunning);
  useLayoutEffect(() => {
    settingsRef.current = settings;
    isExportRunningRef.current = isExportRunning;
  }, [isExportRunning, settings]);

  const { getSnapshot, dispatch } = library;
  useEffect(() => {
    const queue = createTrackAnalysisQueue({
      library: { getSnapshot, dispatch },
      getSettings: () => settingsRef.current,
      isExportRunning: () => isExportRunningRef.current(),
      analyze: (file, duration, signal) =>
        Effect.runPromise(analyzeTrack(file, duration), { signal }),
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
  }, [exporting, library.state.files, settings.djAnalysis]);

  return { pendingTrackIds };
};
