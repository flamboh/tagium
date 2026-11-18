import { formatDetectedKey } from "@/features/analysis/musicalKey";
import { MAX_ANALYSIS_SECONDS, type TrackAnalysis } from "@/features/analysis/trackAnalysis";
import { applyDetectedTrackTagsToFiles } from "@/features/library/fileMetadataOps";
import { createTrackFillQueue, type TrackFillQueue } from "@/features/library/trackFillQueue";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import type { LibraryStore } from "@/features/library/useLibraryStore";

type AnalyzableTrack = TagiumFile & { file: File; metadata: AudioMetadata };

export type TrackAnalysisQueue = TrackFillQueue;

const isAnalyzable = (file: TagiumFile | undefined): file is AnalyzableTrack =>
  Boolean(
    file?.file && file.metadata && file.downloadStatus === "ready" && file.status !== "error",
  );

const hasEmptyDjTag = (file: AnalyzableTrack) =>
  file.metadata.bpm === null || file.metadata.musicalKey === "";

export const createTrackAnalysisQueue = ({
  library,
  getSettings,
  isExportRunning,
  analyze,
  onPendingChange,
}: {
  library: Pick<LibraryStore, "getSnapshot" | "dispatch">;
  getSettings: () => Pick<AppSettings, "djAnalysis" | "keyNotation">;
  isExportRunning: () => boolean;
  analyze: (file: File, duration: number, signal: AbortSignal) => Promise<TrackAnalysis>;
  onPendingChange: (trackIds: ReadonlySet<string>) => void;
}): TrackAnalysisQueue =>
  createTrackFillQueue({
    library,
    isEnabled: () => getSettings().djAnalysis,
    isExportRunning,
    isReady: isAnalyzable,
    needsFill: (file) => hasEmptyDjTag(file) && file.metadata.duration <= MAX_ANALYSIS_SECONDS,
    run: (file, signal) => analyze(file.file, file.metadata.duration, signal),
    apply: (files, trackId, analysis) =>
      applyDetectedTrackTagsToFiles(files, trackId, {
        bpm: analysis.bpm,
        musicalKey: analysis.key ? formatDetectedKey(analysis.key, getSettings().keyNotation) : "",
      }),
    onPendingChange,
  });
