import { describe, expect, it, vi } from "vite-plus/test";
import { createAnalytics } from "@/analytics";

describe("analytics", () => {
  it.each([
    { key: undefined, deployEnv: "production" },
    { key: "public-test-key", deployEnv: "preview" },
    { key: "public-test-key", deployEnv: "test" },
  ])("does no work when disabled by $deployEnv", ({ key, deployEnv }) => {
    const loadClient = vi.fn();
    const schedule = vi.fn();
    const analytics = createAnalytics(
      { key, host: "https://us.i.posthog.com", deployEnv, releaseSha: "release-sha" },
      { loadClient, schedule },
    );

    analytics.initialize();
    analytics.capture({
      type: "audio_upload_completed",
      requestedCount: 2,
      acceptedCount: 1,
      duplicateCount: 1,
      parseRejectedCount: 0,
      targetKind: "loose",
    });

    expect(schedule).not.toHaveBeenCalled();
    expect(loadClient).not.toHaveBeenCalled();
  });

  it("queues early events and adds common fields when the client loads", async () => {
    const init = vi.fn();
    const capture = vi.fn();
    let scheduledLoad: (() => void) | undefined;
    const analytics = createAnalytics(
      {
        key: "public-test-key",
        host: "https://us.i.posthog.com",
        deployEnv: "production",
        releaseSha: "release-sha",
      },
      {
        loadClient: async () => ({ init, capture }),
        schedule: (load) => {
          scheduledLoad = load;
        },
      },
    );

    analytics.initialize();
    analytics.capture({
      type: "audio_upload_completed",
      requestedCount: 3,
      acceptedCount: 1,
      duplicateCount: 1,
      parseRejectedCount: 1,
      targetKind: "album",
    });

    expect(capture).not.toHaveBeenCalled();
    scheduledLoad?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(init).toHaveBeenCalledWith(
      "public-test-key",
      expect.objectContaining({ api_host: "https://us.i.posthog.com" }),
    );
    expect(capture).toHaveBeenCalledWith("audio_upload_completed", {
      event_version: 1,
      deploy_env: "production",
      release_sha: "release-sha",
      requested_count: 3,
      accepted_count: 1,
      duplicate_count: 1,
      parse_rejected_count: 1,
      target_kind: "album",
    });
  });

  it("maps import source URLs to an allowlisted provider", async () => {
    const capture = vi.fn();
    const analytics = createAnalytics(
      {
        key: "public-test-key",
        host: "https://us.i.posthog.com",
        deployEnv: "production",
      },
      {
        loadClient: async () => ({ init: vi.fn(), capture }),
        schedule: (load) => load(),
      },
    );
    analytics.initialize();
    await Promise.resolve();
    await Promise.resolve();

    analytics.capture({
      type: "import_started",
      sourceUrl: "https://music.youtube.com/watch?v=secret",
      importKind: "single",
    });
    analytics.capture({
      type: "import_started",
      sourceUrl: "https://on.soundcloud.com/private-path",
      importKind: "set",
    });
    analytics.capture({
      type: "import_started",
      sourceUrl: "https://media.internal.example/user-specific-name",
      importKind: "single",
    });

    expect(capture.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ provider: "youtube", import_kind: "single" }),
      expect.objectContaining({ provider: "soundcloud", import_kind: "set" }),
      expect.objectContaining({ provider: "other", import_kind: "single" }),
    ]);
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private-path");
    expect(JSON.stringify(capture.mock.calls)).not.toContain("internal.example");
  });

  it("maps import failures to stable codes without serializing exception details", async () => {
    const capture = vi.fn();
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => ({ init: vi.fn(), capture }),
        schedule: (load) => load(),
      },
    );
    analytics.initialize();
    await Promise.resolve();
    await Promise.resolve();

    const cases = [
      [new Error("error.api.capacity_exceeded private upstream detail"), "capacity"],
      [new Error("Cobalt tunnel request failed (429): private body"), "rate_limited"],
      [new Error("error.api.unreachable internal hostname"), "service_unavailable"],
      [new Error("error.api.timed_out after private URL"), "timeout"],
      [new Error("downloaded track could not be parsed: private filename"), "parse_failed"],
      [new Error("unexpected private detail"), "unknown"],
    ] as const;

    for (const [error, expectedCode] of cases) {
      analytics.capture({
        type: "import_finished",
        sourceUrl: "https://soundcloud.com/private-path",
        importKind: "single",
        outcome: "failed",
        totalCount: 1,
        completedCount: 0,
        failedCount: 1,
        canceledCount: 0,
        durationMs: 250,
        error,
      });
      expect(capture.mock.calls.at(-1)?.[1]).toEqual(
        expect.objectContaining({ error_code: expectedCode }),
      );
    }

    const payloads = JSON.stringify(capture.mock.calls);
    expect(payloads).not.toContain("private");
    expect(payloads).not.toContain("error.api");
  });

  it("initializes PostHog with explicit privacy-preserving collection settings", async () => {
    const init = vi.fn();
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => ({ init, capture: vi.fn() }),
        schedule: (load) => load(),
      },
    );

    analytics.initialize();
    await Promise.resolve();
    await Promise.resolve();

    expect(init).toHaveBeenCalledWith(
      "public-test-key",
      expect.objectContaining({
        defaults: "2026-05-30",
        capture_pageview: "history_change",
        capture_pageleave: true,
        autocapture: {
          dom_event_allowlist: ["click", "submit"],
          element_allowlist: ["button", "form"],
        },
        mask_all_text: true,
        mask_all_element_attributes: true,
        disable_session_recording: true,
        enable_heatmaps: false,
        disable_surveys: true,
        person_profiles: "identified_only",
        before_send: expect.any(Function),
      }),
    );
  });

  it("preserves the PostHog transport envelope while redacting unknown or sensitive properties", async () => {
    const init = vi.fn();
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => ({ init, capture: vi.fn() }),
        schedule: (load) => load(),
      },
    );
    analytics.initialize();
    await Promise.resolve();
    await Promise.resolve();

    const options = init.mock.calls[0]?.[1] as {
      before_send: (event: {
        uuid?: string;
        event: string;
        properties: Record<string, unknown>;
        timestamp?: Date;
        $set?: Record<string, unknown>;
      }) => {
        uuid?: string;
        event: string;
        properties: Record<string, unknown>;
        timestamp?: Date;
      } | null;
    };
    const timestamp = new Date("2026-07-09T00:00:00.000Z");
    const custom = options.before_send({
      uuid: "capture-uuid",
      event: "audio_upload_completed",
      timestamp,
      $set: { email: "private@example.com" },
      properties: {
        token: "public-test-key",
        distinct_id: "anonymous-device-id",
        event_version: 1,
        deploy_env: "production",
        requested_count: 2,
        accepted_count: 1,
        duplicate_count: 1,
        parse_rejected_count: 0,
        target_kind: "loose",
        source_url: "https://soundcloud.com/private-path",
        error_message: "private upstream response",
        unexpected_property: "private metadata",
        $email: "private@example.com",
        $browser: "Chrome",
        $current_url: "https://tagium.example/?private=query",
      },
    });
    const pageview = options.before_send({
      event: "$pageview",
      properties: {
        $browser: "Chrome",
        $current_url: "https://tagium.example/?private=query",
        $referrer: "https://internal.example/user-name",
        $pathname: "/private-path",
      },
    });

    expect(custom).toEqual({
      uuid: "capture-uuid",
      event: "audio_upload_completed",
      timestamp,
      properties: {
        token: "public-test-key",
        distinct_id: "anonymous-device-id",
        event_version: 1,
        deploy_env: "production",
        requested_count: 2,
        accepted_count: 1,
        duplicate_count: 1,
        parse_rejected_count: 0,
        target_kind: "loose",
        $browser: "Chrome",
      },
    });
    expect(pageview).toEqual({
      event: "$pageview",
      properties: { $browser: "Chrome", app_view: "tagium" },
    });
    expect(
      options.before_send({ event: "made_up_event", properties: { private: "value" } }),
    ).toBeNull();
  });

  it("fails open when the analytics provider throws and keeps accepting captures", async () => {
    const capture = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("provider unavailable");
      })
      .mockImplementation(() => undefined);
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => ({ init: vi.fn(), capture }),
        schedule: (load) => load(),
      },
    );
    analytics.initialize();
    await Promise.resolve();
    await Promise.resolve();

    expect(() =>
      analytics.capture({
        type: "audio_upload_completed",
        requestedCount: 1,
        acceptedCount: 1,
        duplicateCount: 0,
        parseRejectedCount: 0,
        targetKind: "loose",
      }),
    ).not.toThrow();
    expect(() =>
      analytics.capture({
        type: "audio_upload_completed",
        requestedCount: 2,
        acceptedCount: 2,
        duplicateCount: 0,
        parseRejectedCount: 0,
        targetKind: "loose",
      }),
    ).not.toThrow();

    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("bounds the early-event queue and keeps the most recent events", async () => {
    const capture = vi.fn();
    let scheduledLoad: (() => void) | undefined;
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => ({ init: vi.fn(), capture }),
        schedule: (load) => {
          scheduledLoad = load;
        },
      },
    );

    for (let requestedCount = 1; requestedCount <= 101; requestedCount += 1) {
      analytics.capture({
        type: "audio_upload_completed",
        requestedCount,
        acceptedCount: requestedCount,
        duplicateCount: 0,
        parseRejectedCount: 0,
        targetKind: "loose",
      });
    }
    scheduledLoad?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(capture).toHaveBeenCalledTimes(100);
    expect(capture.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ requested_count: 2 }));
    expect(capture.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({ requested_count: 101 }),
    );
  });

  it("serializes export milestones without claiming the browser saved the file", async () => {
    const capture = vi.fn();
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => ({ init: vi.fn(), capture }),
        schedule: (load) => load(),
      },
    );
    analytics.initialize();
    await Promise.resolve();
    await Promise.resolve();

    analytics.capture({
      type: "export_started",
      exportKind: "library",
      trackCount: 24,
      albumCount: 3,
    });
    analytics.capture({
      type: "export_prepared",
      exportKind: "library",
      trackCount: 24,
      albumCount: 3,
      sizeBytes: 12 * 1024 * 1024,
    });
    analytics.capture({
      type: "export_failed",
      exportKind: "library",
      error: new Error("metadata write failed for private filename"),
    });

    expect(capture.mock.calls).toEqual([
      [
        "export_started",
        expect.objectContaining({ export_kind: "library", track_count: 24, album_count: 3 }),
      ],
      [
        "export_prepared",
        expect.objectContaining({
          export_kind: "library",
          track_count: 24,
          album_count: 3,
          size_bucket: "10_to_100_mb",
        }),
      ],
      [
        "export_failed",
        expect.objectContaining({ export_kind: "library", error_code: "metadata_write_failed" }),
      ],
    ]);
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private filename");
  });

  it("serializes allowlisted mutation and controller facts", async () => {
    const capture = vi.fn();
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => ({ init: vi.fn(), capture }),
        schedule: (load) => load(),
      },
    );
    analytics.initialize();
    await Promise.resolve();
    await Promise.resolve();

    analytics.capture({
      type: "settings_changed",
      syncTrackNumbers: true,
      syncFilenames: false,
      audioBitrate: "256",
      applySoundCloudCover: true,
    });
    analytics.capture({ type: "album_created", trackCount: 4, hasCover: true });
    analytics.capture({ type: "album_edited", trackCount: 4, hasCover: false });
    analytics.capture({ type: "tracks_removed", trackCount: 2, sourceMix: "mixed" });
    analytics.capture({
      type: "import_cancel_requested",
      totalCount: 8,
      completedCount: 3,
      activeCount: 2,
      pendingCount: 3,
    });
    analytics.capture({
      type: "import_retry_started",
      provider: "youtube",
      retryCount: 2,
      previousFailedCount: 1,
      previousCanceledCount: 1,
    });

    expect(capture.mock.calls.map(([name, properties]) => [name, properties])).toEqual([
      [
        "settings_changed",
        expect.objectContaining({
          sync_track_numbers: true,
          sync_filenames: false,
          audio_bitrate: "256",
          apply_soundcloud_cover: true,
        }),
      ],
      ["album_created", expect.objectContaining({ track_count: 4, has_cover: true })],
      ["album_edited", expect.objectContaining({ track_count: 4, has_cover: false })],
      ["tracks_removed", expect.objectContaining({ track_count: 2, source_mix: "mixed" })],
      [
        "import_cancel_requested",
        expect.objectContaining({
          total_count: 8,
          completed_count: 3,
          active_count: 2,
          pending_count: 3,
        }),
      ],
      [
        "import_retry_started",
        expect.objectContaining({
          provider: "youtube",
          retry_count: 2,
          previous_failed_count: 1,
          previous_canceled_count: 1,
        }),
      ],
    ]);
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private-one");
  });

  it("keeps queued events and retries after an SDK load failure", async () => {
    const capture = vi.fn();
    let attempts = 0;
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("blocked SDK request");
          return { init: vi.fn(), capture };
        },
        schedule: (load) => load(),
      },
    );
    analytics.capture({
      type: "audio_upload_completed",
      requestedCount: 1,
      acceptedCount: 1,
      duplicateCount: 0,
      parseRejectedCount: 0,
      targetKind: "loose",
    });
    await Promise.resolve();
    await Promise.resolve();

    analytics.capture({
      type: "audio_upload_completed",
      requestedCount: 2,
      acceptedCount: 2,
      duplicateCount: 0,
      parseRejectedCount: 0,
      targetKind: "loose",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(attempts).toBe(2);
    expect(capture).toHaveBeenCalledTimes(2);
  });
});
