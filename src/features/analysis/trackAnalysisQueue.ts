import { formatDetectedKey } from "@/features/analysis/musicalKey";
import { MAX_ANALYSIS_SECONDS, type TrackAnalysis } from "@/features/analysis/trackAnalysis";
import { applyDetectedTrackTagsToFiles } from "@/features/library/fileMetadataOps";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import type { LibraryStore } from "@/features/library/useLibraryStore";

type AnalyzableTrack = TagiumFile & { file: File; metadata: AudioMetadata };

export interface TrackAnalysisQueue {
  /** Queues newly eligible tracks; call whenever the library or the settings change. */
  sync: () => void;
  dispose: () => void;
}

const isAnalyzable = (file: TagiumFile | undefined): file is AnalyzableTrack =>
  Boolean(
    file?.file && file.metadata && file.downloadStatus === "ready" && file.status !== "error",
  );

const hasEmptyDjTag = (file: AnalyzableTrack) =>
  file.metadata.bpm === null || file.metadata.musicalKey === "";

/**
 * Analyzes library tracks one at a time and fills their empty tempo and key. A track is analyzed
 * at most once, so clearing a detected value or a failed analysis never triggers another pass.
 * Results that land while an export is running are held until it finishes, so they never change
 * the library under an export.
 */
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
}): TrackAnalysisQueue => {
  const attempted = new Set<string>();
  const held = new Map<string, TrackAnalysis>();
  let queued: string[] = [];
  let running: { trackId: string; controller: AbortController } | null = null;
  let pendingKey = "";
  let disposed = false;

  const emitPending = () => {
    const pending = [...(running ? [running.trackId] : []), ...queued, ...held.keys()];
    const key = pending.join("\n");

    if (key === pendingKey) return;
    pendingKey = key;
    onPendingChange(new Set(pending));
  };

  /** Stops the running analysis; the track is analyzed again the next time it is eligible. */
  const cancelRunning = () => {
    if (!running) return;
    attempted.delete(running.trackId);
    running.controller.abort();
    running = null;
  };

  const applyAnalysis = (trackId: string, analysis: TrackAnalysis) => {
    if (isExportRunning()) {
      held.set(trackId, analysis);

      return;
    }

    const settings = getSettings();
    const { files } = library.getSnapshot();

    const nextFiles = applyDetectedTrackTagsToFiles(files, trackId, {
      bpm: analysis.bpm,
      musicalKey: analysis.key ? formatDetectedKey(analysis.key, settings.keyNotation) : "",
    });

    if (nextFiles !== files) library.dispatch({ type: "content-replaced", files: nextFiles });
  };

  const runNext = () => {
    while (!running && !disposed) {
      const trackId = queued[0];

      if (trackId === undefined) return;
      queued = queued.slice(1);
      const file = library.getSnapshot().files.find((candidate) => candidate.id === trackId);

      if (!isAnalyzable(file)) continue;
      attempted.add(trackId);

      if (!hasEmptyDjTag(file)) continue;

      const run = { trackId, controller: new AbortController() };
      running = run;
      void analyze(file.file, file.metadata.duration, run.controller.signal)
        .then(
          (analysis) => {
            // A cancelled run's result is discarded even if it finished before the abort landed.
            if (running === run) applyAnalysis(trackId, analysis);
          },
          // A track that cannot be decoded or analyzed simply keeps its empty fields.
          () => undefined,
        )
        .finally(() => {
          if (running === run) {
            running = null;
            runNext();
          }

          emitPending();
        });
    }
  };

  return {
    sync: () => {
      if (disposed) return;
      const { files } = library.getSnapshot();
      const trackIds = new Set(files.map((file) => file.id));

      for (const trackId of attempted) {
        if (!trackIds.has(trackId)) attempted.delete(trackId);
      }

      for (const trackId of held.keys()) {
        if (!trackIds.has(trackId)) held.delete(trackId);
      }

      if (running && !trackIds.has(running.trackId)) cancelRunning();

      if (!getSettings().djAnalysis) {
        cancelRunning();
        queued = [];

        // Dropped results leave their tracks eligible for when the setting is turned back on.
        for (const trackId of held.keys()) attempted.delete(trackId);
        held.clear();
        emitPending();

        return;
      }

      if (!isExportRunning()) {
        for (const [trackId, analysis] of held) {
          held.delete(trackId);
          applyAnalysis(trackId, analysis);
        }
      }

      queued = queued.filter((trackId) => trackIds.has(trackId));
      const queuedIds = new Set(queued);
      const latestFiles = library.getSnapshot().files;

      for (const file of latestFiles) {
        if (attempted.has(file.id) || file.id === running?.trackId || queuedIds.has(file.id)) {
          continue;
        }

        if (!isAnalyzable(file)) continue;

        if (!hasEmptyDjTag(file) || file.metadata.duration > MAX_ANALYSIS_SECONDS) {
          attempted.add(file.id);
          continue;
        }

        queued.push(file.id);
      }

      runNext();
      emitPending();
    },
    dispose: () => {
      disposed = true;
      cancelRunning();
      queued = [];
      held.clear();
    },
  };
};
