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
 */
export const createTrackAnalysisQueue = ({
  library,
  getSettings,
  analyze,
  onPendingChange,
}: {
  library: Pick<LibraryStore, "getSnapshot" | "dispatch">;
  getSettings: () => Pick<AppSettings, "djAnalysis" | "keyNotation">;
  analyze: (file: File, duration: number) => Promise<TrackAnalysis>;
  onPendingChange: (trackIds: ReadonlySet<string>) => void;
}): TrackAnalysisQueue => {
  const attempted = new Set<string>();
  let queued: string[] = [];
  let running: string | null = null;
  let pendingKey = "";
  let disposed = false;

  const emitPending = () => {
    const pending = running ? [running, ...queued] : queued;
    const key = pending.join("\n");

    if (key === pendingKey) return;
    pendingKey = key;
    onPendingChange(new Set(pending));
  };

  const applyAnalysis = (trackId: string, analysis: TrackAnalysis) => {
    const settings = getSettings();

    if (disposed) return;

    if (!settings.djAnalysis) {
      // The result is dropped, so the track stays eligible if the setting is turned back on.
      attempted.delete(trackId);

      return;
    }

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

      running = trackId;
      void analyze(file.file, file.metadata.duration)
        .then(
          (analysis) => applyAnalysis(trackId, analysis),
          // A track that cannot be decoded or analyzed simply keeps its empty fields.
          () => undefined,
        )
        .finally(() => {
          running = null;
          runNext();
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

      if (!getSettings().djAnalysis) {
        queued = [];
        emitPending();

        return;
      }

      queued = queued.filter((trackId) => trackIds.has(trackId));

      for (const file of files) {
        if (attempted.has(file.id) || file.id === running || queued.includes(file.id)) continue;

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
      queued = [];
    },
  };
};
