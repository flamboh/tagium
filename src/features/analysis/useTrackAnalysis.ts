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
}: {
  library: LibraryStore;
  settings: AppSettings;
}) => {
  const [pendingTrackIds, setPendingTrackIds] = useState(noPendingTracks);
  const settingsRef = useRef(settings);
  const queueRef = useRef<TrackAnalysisQueue | null>(null);
  useLayoutEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const { getSnapshot, dispatch } = library;
  useEffect(() => {
    const queue = createTrackAnalysisQueue({
      library: { getSnapshot, dispatch },
      getSettings: () => settingsRef.current,
      analyze: (file, duration) => Effect.runPromise(analyzeTrack(file, duration)),
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
  }, [library.state.files, settings.djAnalysis]);

  return { pendingTrackIds };
};
