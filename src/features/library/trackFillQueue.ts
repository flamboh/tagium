import type { TagiumFile } from "@/features/library/types";
import type { LibraryStore } from "@/features/library/useLibraryStore";

export interface TrackFillQueue {
  sync: () => void;
  dispose: () => void;
}

export const createTrackFillQueue = <Track extends TagiumFile, Result>({
  library,
  getCurrentFiles = () => library.getSnapshot().files,
  isEnabled,
  isExportRunning,
  isReady,
  needsFill,
  inputKey = () => "",
  run,
  apply,
  onPendingChange,
}: {
  library: Pick<LibraryStore, "getSnapshot" | "dispatch">;
  getCurrentFiles?: () => TagiumFile[];
  isEnabled: () => boolean;
  isExportRunning: () => boolean;
  isReady: (file: TagiumFile | undefined) => file is Track;
  needsFill: (track: Track) => boolean;
  inputKey?: (track: Track) => string;
  run: (track: Track, signal: AbortSignal) => Promise<Result>;
  apply: (files: TagiumFile[], trackId: string, result: Result) => TagiumFile[];
  onPendingChange: (trackIds: ReadonlySet<string>) => void;
}): TrackFillQueue => {
  const attempted = new Map<string, string>();
  const held = new Map<string, { input: string; result: Result }>();
  let queued: string[] = [];
  let running: { trackId: string; input: string; controller: AbortController } | null = null;
  let pendingKey = "";
  let disposed = false;

  const emitPending = () => {
    const pending = [...(running ? [running.trackId] : []), ...queued, ...held.keys()];
    const key = pending.join("\n");

    if (key === pendingKey) return;
    pendingKey = key;
    onPendingChange(new Set(pending));
  };

  const cancelRunning = () => {
    if (!running) return;
    attempted.delete(running.trackId);
    running.controller.abort();
    running = null;
  };

  const findFile = (trackId: string) =>
    getCurrentFiles().find((candidate) => candidate.id === trackId);

  const isAttempted = (file: Track) => attempted.get(file.id) === inputKey(file);

  const isStale = (trackId: string, input: string) => {
    const file = findFile(trackId);

    return !isReady(file) || inputKey(file) !== input || !needsFill(file);
  };

  const applyResult = (trackId: string, input: string, result: Result) => {
    if (isExportRunning()) {
      held.set(trackId, { input, result });

      return;
    }

    if (isStale(trackId, input)) return;

    const { files } = library.getSnapshot();
    const nextFiles = apply(files, trackId, result);

    if (nextFiles !== files) library.dispatch({ type: "content-replaced", files: nextFiles });
  };

  const runNext = () => {
    while (!running && !disposed) {
      const trackId = queued[0];

      if (trackId === undefined) return;
      queued = queued.slice(1);
      const file = findFile(trackId);

      if (!isReady(file)) continue;
      const input = inputKey(file);
      attempted.set(trackId, input);

      if (!needsFill(file)) continue;

      const job = { trackId, input, controller: new AbortController() };
      running = job;
      void run(file, job.controller.signal)
        .then(
          (result) => {
            if (running === job) applyResult(trackId, input, result);
          },
          () => undefined,
        )
        .finally(() => {
          if (running === job) {
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

      for (const trackId of attempted.keys()) {
        if (!trackIds.has(trackId)) attempted.delete(trackId);
      }

      for (const trackId of held.keys()) {
        if (!trackIds.has(trackId)) held.delete(trackId);
      }

      if (running && isStale(running.trackId, running.input)) cancelRunning();

      if (!isEnabled()) {
        cancelRunning();
        queued = [];

        for (const trackId of held.keys()) attempted.delete(trackId);
        held.clear();
        emitPending();

        return;
      }

      if (!isExportRunning()) {
        for (const [trackId, { input, result }] of held) {
          held.delete(trackId);
          applyResult(trackId, input, result);
        }
      }

      queued = queued.filter((trackId) => trackIds.has(trackId));
      const queuedIds = new Set(queued);
      const latestFiles = getCurrentFiles();

      for (const file of latestFiles) {
        if (file.id === running?.trackId || queuedIds.has(file.id) || !isReady(file)) continue;

        if (isAttempted(file)) continue;

        if (!needsFill(file)) {
          attempted.set(file.id, inputKey(file));
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
