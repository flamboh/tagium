import type { Analytics, ImportKind, ImportOutcome } from "@/src/analytics";

export type ImportTrackOutcome = "completed" | "failed" | "canceled";

interface ImportOperation {
  sourceUrl: string;
  importKind: ImportKind;
  startedAt: number;
  trackIds: Set<string>;
  settledTracks: Map<string, { outcome: ImportTrackOutcome; error?: unknown }>;
}

interface ImportLifecycleDependencies {
  capture: Analytics["capture"];
  createId: () => string;
  now: () => number;
}

export interface ImportLifecycleTracker {
  start: (input: { sourceUrl: string; importKind: ImportKind }) => string;
  resolve: (operationId: string, resolution: { trackIds: string[]; hasCover: boolean }) => void;
  fail: (operationId: string, error: unknown, failureStage: "resolve") => void;
  settle: (
    operationId: string,
    settlement: { trackId: string; outcome: ImportTrackOutcome; error?: unknown },
  ) => void;
}

const deriveOutcome = (counts: {
  completed: number;
  failed: number;
  canceled: number;
}): ImportOutcome => {
  if (counts.canceled > 0) return "canceled";
  if (counts.failed === 0) return "completed";
  if (counts.completed > 0) return "partial";
  return "failed";
};

export const createImportLifecycleTracker = (
  dependencies: ImportLifecycleDependencies,
): ImportLifecycleTracker => {
  const operations = new Map<string, ImportOperation>();

  return {
    start: ({ sourceUrl, importKind }) => {
      const operationId = dependencies.createId();
      operations.set(operationId, {
        sourceUrl,
        importKind,
        startedAt: dependencies.now(),
        trackIds: new Set(),
        settledTracks: new Map(),
      });
      dependencies.capture({ type: "import_started", sourceUrl, importKind });
      return operationId;
    },
    resolve: (operationId, { trackIds, hasCover }) => {
      const operation = operations.get(operationId);
      if (!operation) return;
      operation.trackIds = new Set(trackIds);
      if (operation.importKind === "set") {
        dependencies.capture({
          type: "import_resolved",
          sourceUrl: operation.sourceUrl,
          importKind: operation.importKind,
          resolvedCount: operation.trackIds.size,
          hasCover,
        });
      }
    },
    fail: (operationId, error, failureStage) => {
      const operation = operations.get(operationId);
      if (!operation) return;
      operations.delete(operationId);
      dependencies.capture({
        type: "import_finished",
        sourceUrl: operation.sourceUrl,
        importKind: operation.importKind,
        outcome: "failed",
        totalCount: 0,
        completedCount: 0,
        failedCount: 0,
        canceledCount: 0,
        durationMs: Math.max(0, dependencies.now() - operation.startedAt),
        error,
        failureStage,
      });
    },
    settle: (operationId, settlement) => {
      const operation = operations.get(operationId);
      if (!operation) return;
      if (!operation.trackIds.has(settlement.trackId)) return;
      if (operation.settledTracks.has(settlement.trackId)) return;
      operation.settledTracks.set(settlement.trackId, settlement);
      if (operation.settledTracks.size !== operation.trackIds.size) return;

      let completed = 0;
      let failed = 0;
      let canceled = 0;
      let firstError: unknown;
      for (const result of operation.settledTracks.values()) {
        if (result.outcome === "completed") completed += 1;
        if (result.outcome === "failed") {
          failed += 1;
          firstError ??= result.error;
        }
        if (result.outcome === "canceled") canceled += 1;
      }
      operations.delete(operationId);
      dependencies.capture({
        type: "import_finished",
        sourceUrl: operation.sourceUrl,
        importKind: operation.importKind,
        outcome: deriveOutcome({ completed, failed, canceled }),
        totalCount: operation.trackIds.size,
        completedCount: completed,
        failedCount: failed,
        canceledCount: canceled,
        durationMs: Math.max(0, dependencies.now() - operation.startedAt),
        ...(firstError === undefined ? {} : { error: firstError }),
      });
    },
  };
};
