import type {
  Analytics,
  ImportFailureCode,
  ImportFailureStage,
  ImportKind,
  ImportOutcome,
} from "@/analytics";

export type ImportTrackOutcome = "completed" | "failed" | "canceled";

export class ImportStageError extends Error {
  readonly stage: Exclude<ImportFailureStage, "hydration">;

  constructor(stage: ImportStageError["stage"], cause: unknown) {
    super(errorMessage(cause), { cause });
    this.name = "ImportStageError";
    this.stage = stage;
  }
}

interface ImportOperation {
  sourceUrl: string;
  importKind: ImportKind;
  startedAt: number;
  trackIds: Set<string>;
  settledTracks: Map<
    string,
    {
      outcome: ImportTrackOutcome;
      error?: unknown;
      failureStage?: ImportFailureStage;
    }
  >;
}

interface ImportLifecycleDependencies {
  capture: Analytics["capture"];
  createId: () => string;
  now: () => number;
}

export interface ImportLifecycleTracker {
  start: (input: { sourceUrl: string; importKind: ImportKind }) => string;
  resolve: (operationId: string, resolution: { trackIds: string[]; hasCover: boolean }) => void;
  fail: (operationId: string, error: unknown) => void;
  settle: (
    operationId: string,
    settlement: {
      trackId: string;
      outcome: ImportTrackOutcome;
      error?: unknown;
      failureStage?: ImportFailureStage;
    },
  ) => void;
}

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "";
};

export const importFailureCodeFrom = (error: unknown): ImportFailureCode => {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("error.api.capacity_exceeded")) return "capacity";
  if (
    message.includes("error.api.rate_exceeded") ||
    message.includes("rate limit") ||
    /\b429\b/.test(message)
  ) {
    return "rate_limited";
  }
  if (
    message.includes("error.api.unreachable") ||
    message.includes("cobalt_api_url is not configured") ||
    message.includes("networkerror") ||
    message.includes("failed to fetch")
  ) {
    return "service_unavailable";
  }
  if (message.includes("error.api.timed_out") || /\btimed?\s*out\b/.test(message)) {
    return "timeout";
  }
  if (message.includes("error.api.fetch.empty") || message.includes("response was empty")) {
    return "empty_response";
  }
  if (message.includes("error.api.fetch.fail")) return "fetch_failed";
  if (/metadata.*(?:write|appl)|write.*metadata/.test(message)) return "metadata_write_failed";
  if (/could not be parsed|decode|malformed|metadata read/.test(message)) return "parse_failed";
  return "unknown";
};

export const importFailureStageFromDownloadError = (error: unknown): ImportFailureStage =>
  error instanceof ImportStageError ? error.stage : "plan";

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
    fail: (operationId, error) => {
      const operation = operations.get(operationId);
      if (!operation) return;
      operations.delete(operationId);
      dependencies.capture({
        type: "import_resolution_failed",
        sourceUrl: operation.sourceUrl,
        importKind: operation.importKind,
        code: importFailureCodeFrom(error),
      });
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
      const failures = new Map<
        string,
        { stage: ImportFailureStage; code: ImportFailureCode; count: number }
      >();
      for (const result of operation.settledTracks.values()) {
        if (result.outcome === "completed") completed += 1;
        if (result.outcome === "failed") {
          failed += 1;
          const stage = result.failureStage ?? "plan";
          const code = importFailureCodeFrom(result.error);
          const key = `${stage}:${code}`;
          const aggregate = failures.get(key);
          if (aggregate) aggregate.count += 1;
          else failures.set(key, { stage, code, count: 1 });
        }
        if (result.outcome === "canceled") canceled += 1;
      }
      operations.delete(operationId);
      for (const failure of failures.values()) {
        dependencies.capture({
          type: "import_failure_category",
          sourceUrl: operation.sourceUrl,
          importKind: operation.importKind,
          stage: failure.stage,
          code: failure.code,
          trackCount: failure.count,
        });
      }
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
      });
    },
  };
};
