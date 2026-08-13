import { describe, expect, it } from "vite-plus/test";
import type { AnalyticsEvent } from "@/analytics";
import {
  createImportLifecycleTracker,
  ImportStageError,
  importFailureStageFromDownloadError,
} from "@/features/import/importLifecycle";

describe("import lifecycle", () => {
  it.each([
    [new Error("error.api.fetch.fail"), "plan"],
    [new ImportStageError("plan", new Error("malformed cobalt audio plan")), "plan"],
    [new ImportStageError("tunnel", new Error("error.api.capacity_exceeded")), "tunnel"],
    [new ImportStageError("processing", new Error("arbitrary worker failure")), "processing"],
  ] as const)("preserves the typed download failure stage", (error, stage) => {
    expect(importFailureStageFromDownloadError(error)).toBe(stage);
  });
  it("emits one completed outcome after every resolved track completes", () => {
    const captured: AnalyticsEvent[] = [];
    let now = 100;
    const tracker = createImportLifecycleTracker({
      capture: (event) => captured.push(event),
      createId: () => "local-operation-id",
      now: () => now,
    });

    const operationId = tracker.start({
      sourceUrl: "https://soundcloud.com/artist/sets/private-set",
      importKind: "set",
    });
    tracker.resolve(operationId, {
      trackIds: ["track-1", "track-2"],
      hasCover: true,
    });
    tracker.settle(operationId, { trackId: "track-1", outcome: "completed" });
    now = 350;
    tracker.settle(operationId, { trackId: "track-2", outcome: "completed" });
    tracker.settle(operationId, { trackId: "track-2", outcome: "completed" });

    expect(operationId).toBe("local-operation-id");
    expect(captured).toEqual([
      {
        type: "import_started",
        sourceUrl: "https://soundcloud.com/artist/sets/private-set",
        importKind: "set",
      },
      {
        type: "import_resolved",
        sourceUrl: "https://soundcloud.com/artist/sets/private-set",
        importKind: "set",
        resolvedCount: 2,
        hasCover: true,
      },
      {
        type: "import_finished",
        sourceUrl: "https://soundcloud.com/artist/sets/private-set",
        importKind: "set",
        outcome: "completed",
        totalCount: 2,
        completedCount: 2,
        failedCount: 0,
        canceledCount: 0,
        durationMs: 250,
      },
    ]);
  });

  it("finishes a resolver failure without inventing track counts", () => {
    const captured: AnalyticsEvent[] = [];
    let now = 1_000;
    const tracker = createImportLifecycleTracker({
      capture: (event) => captured.push(event),
      createId: () => "resolution-operation",
      now: () => now,
    });
    const operationId = tracker.start({
      sourceUrl: "https://soundcloud.com/artist/sets/private-set",
      importKind: "set",
    });
    now = 1_125;

    tracker.fail(operationId, new Error("error.api.fetch.fail private resolver response"));
    tracker.fail(operationId, new Error("duplicate failure"));

    expect(captured.slice(-2)).toEqual([
      {
        type: "import_resolution_failed",
        sourceUrl: "https://soundcloud.com/artist/sets/private-set",
        importKind: "set",
        code: "fetch_failed",
      },
      {
        type: "import_finished",
        sourceUrl: "https://soundcloud.com/artist/sets/private-set",
        importKind: "set",
        outcome: "failed",
        totalCount: 0,
        completedCount: 0,
        failedCount: 0,
        canceledCount: 0,
        durationMs: 125,
      },
    ]);
    expect(captured).toHaveLength(3);
  });

  it.each([
    {
      settlements: ["completed", "failed"] as const,
      expectedOutcome: "partial" as const,
      expectedCounts: { completedCount: 1, failedCount: 1, canceledCount: 0 },
    },
    {
      settlements: ["completed", "canceled"] as const,
      expectedOutcome: "canceled" as const,
      expectedCounts: { completedCount: 1, failedCount: 0, canceledCount: 1 },
    },
  ])(
    "classifies terminal track outcomes as $expectedOutcome",
    ({ settlements, expectedOutcome, expectedCounts }) => {
      const captured: AnalyticsEvent[] = [];
      const tracker = createImportLifecycleTracker({
        capture: (event) => captured.push(event),
        createId: () => "operation",
        now: () => 100,
      });
      const operationId = tracker.start({
        sourceUrl: "https://soundcloud.com/artist/sets/set",
        importKind: "set",
      });
      tracker.resolve(operationId, { trackIds: ["track-1", "track-2"], hasCover: false });
      tracker.settle(operationId, { trackId: "track-1", outcome: settlements[0] });
      const secondSettlement: Parameters<typeof tracker.settle>[1] = {
        trackId: "track-2",
        outcome: settlements[1],
      };
      if (settlements[1] === "failed") secondSettlement.error = new Error("failed");
      tracker.settle(operationId, secondSettlement);

      expect(captured.at(-1)).toEqual(
        expect.objectContaining({ outcome: expectedOutcome, ...expectedCounts }),
      );
    },
  );

  it("aggregates stable failure categories across a playlist", () => {
    const captured: AnalyticsEvent[] = [];
    const tracker = createImportLifecycleTracker({
      capture: (event) => captured.push(event),
      createId: () => "operation",
      now: () => 100,
    });
    const operationId = tracker.start({
      sourceUrl: "https://soundcloud.com/artist/sets/set",
      importKind: "set",
    });
    tracker.resolve(operationId, {
      trackIds: ["track-1", "track-2", "track-3"],
      hasCover: false,
    });

    tracker.settle(operationId, {
      trackId: "track-1",
      outcome: "failed",
      failureStage: "tunnel",
      error: new Error("Cobalt tunnel response was empty."),
    });
    tracker.settle(operationId, {
      trackId: "track-2",
      outcome: "failed",
      failureStage: "plan",
      error: new Error("error.api.fetch.empty request-id=private"),
    });
    tracker.settle(operationId, {
      trackId: "track-3",
      outcome: "failed",
      failureStage: "hydration",
      error: new Error("downloaded track could not be parsed: /private/file.mp3"),
    });

    expect(captured.slice(-4, -1)).toEqual([
      expect.objectContaining({
        type: "import_failure_category",
        stage: "tunnel",
        code: "empty_response",
        trackCount: 1,
      }),
      expect.objectContaining({
        type: "import_failure_category",
        stage: "plan",
        code: "empty_response",
        trackCount: 1,
      }),
      expect.objectContaining({
        type: "import_failure_category",
        stage: "hydration",
        code: "parse_failed",
        trackCount: 1,
      }),
    ]);
    expect(
      captured
        .filter((event) => event.type === "import_failure_category")
        .reduce((sum, event) => sum + event.trackCount, 0),
    ).toBe(3);
    expect(JSON.stringify(captured.slice(-4))).not.toContain("private");
  });
});
