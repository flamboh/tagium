import { describe, expect, it } from "vite-plus/test";
import type { AnalyticsEvent } from "@/src/analytics";
import { createImportLifecycleTracker } from "./importLifecycle";

describe("import lifecycle", () => {
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

    tracker.fail(operationId, new Error("private resolver response"), "resolve");
    tracker.fail(operationId, new Error("duplicate failure"), "resolve");

    expect(captured.at(-1)).toEqual({
      type: "import_finished",
      sourceUrl: "https://soundcloud.com/artist/sets/private-set",
      importKind: "set",
      outcome: "failed",
      totalCount: 0,
      completedCount: 0,
      failedCount: 0,
      canceledCount: 0,
      durationMs: 125,
      error: expect.any(Error),
      failureStage: "resolve",
    });
    expect(captured).toHaveLength(2);
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
      tracker.settle(operationId, {
        trackId: "track-2",
        outcome: settlements[1],
        ...(settlements[1] === "failed" ? { error: new Error("failed") } : {}),
      });

      expect(captured.at(-1)).toEqual(
        expect.objectContaining({ outcome: expectedOutcome, ...expectedCounts }),
      );
    },
  );
});
