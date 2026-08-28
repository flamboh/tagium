import { describe, expect, it, vi } from "vite-plus/test";
import type { BeforeSendFn } from "posthog-js";
import { analyticsOutputFormatFromFilename, createAnalytics } from "@/analytics";

type AnalyticsInitOptions = { before_send: BeforeSendFn };

describe("analytics", () => {
  it("derives only allowlisted formats from real filename extensions", () => {
    expect(analyticsOutputFormatFromFilename("track.MP3")).toBe("mp3");
    expect(analyticsOutputFormatFromFilename("mp3")).toBe("other");
    expect(analyticsOutputFormatFromFilename("track.mov")).toBe("other");
  });

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

    analytics.initialize("tagium");
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
        host: "https://t.tagium.app",
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

    analytics.initialize("tagium");
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
      expect.objectContaining({
        api_host: "https://t.tagium.app",
        ui_host: "https://us.posthog.com",
      }),
    );
    expect(capture).toHaveBeenCalledWith("audio_upload_completed", {
      event_version: 1,
      deploy_env: "production",
      release_sha: "release-sha",
      app_id: "tagium",
      requested_count: 3,
      accepted_count: 1,
      duplicate_count: 1,
      parse_rejected_count: 1,
      target_kind: "album",
    });
  });

  it.each(["tagium", "tagium-save"] as const)(
    "tags custom and SDK events with the %s app id",
    async (appId) => {
      const init = vi.fn();
      const capture = vi.fn();
      const analytics = createAnalytics(
        { key: "public-test-key", deployEnv: "production" },
        {
          loadClient: async () => ({ init, capture }),
          schedule: (load) => load(),
        },
      );
      analytics.initialize(appId);
      await Promise.resolve();
      await Promise.resolve();

      analytics.capture({
        type: "media_link_processed",
        sourceUrl: "https://youtube.com/watch?v=private-id",
        mediaKind: "media",
        linkKind: "canonical",
        normalized: false,
        redirected: false,
        outcome: "accepted",
      });

      expect(capture).toHaveBeenCalledWith(
        "media_link_processed",
        expect.objectContaining({ app_id: appId, provider: "youtube", media_kind: "media" }),
      );

      const options = init.mock.calls[0]?.[1] as AnalyticsInitOptions;
      expect(
        options.before_send({
          uuid: "pageview-uuid",
          event: "$pageview",
          properties: { app_id: "spoofed", $browser: "Safari" },
        }),
      ).toEqual({
        uuid: "pageview-uuid",
        event: "$pageview",
        properties: { $browser: "Safari", app_id: appId },
      });
    },
  );

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
    analytics.initialize("tagium");
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

  it("carries the requested format through the Tagium import lifecycle", async () => {
    const capture = vi.fn();
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => ({ init: vi.fn(), capture }),
        schedule: (load) => load(),
      },
    );
    analytics.initialize("tagium");
    await Promise.resolve();
    await Promise.resolve();

    const sourceUrl = "https://soundcloud.com/private-artist/private-track";
    analytics.capture({
      type: "import_started",
      sourceUrl,
      importKind: "single",
      requestedFormat: "mp3",
    });
    analytics.capture({
      type: "import_resolved",
      sourceUrl,
      importKind: "single",
      resolvedCount: 1,
      hasCover: true,
      requestedFormat: "mp3",
    });
    analytics.capture({
      type: "import_finished",
      sourceUrl,
      importKind: "single",
      outcome: "completed",
      totalCount: 1,
      completedCount: 1,
      failedCount: 0,
      canceledCount: 0,
      durationMs: 250,
      requestedFormat: "mp3",
    });
    analytics.capture({
      type: "import_resolution_failed",
      sourceUrl,
      importKind: "single",
      code: "timeout",
      requestedFormat: "mp3",
    });
    analytics.capture({
      type: "import_failure_category",
      sourceUrl,
      importKind: "single",
      stage: "processing",
      code: "parse_failed",
      trackCount: 1,
      requestedFormat: "mp3",
    });

    expect(capture.mock.calls).toHaveLength(5);
    for (const [, properties] of capture.mock.calls) {
      expect(properties).toEqual(
        expect.objectContaining({
          app_id: "tagium",
          provider: "soundcloud",
          requested_format: "mp3",
        }),
      );
    }
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private-artist");
  });

  it("serializes privacy-safe share lifecycle events", async () => {
    const capture = vi.fn();
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => ({ init: vi.fn(), capture }),
        schedule: (load) => load(),
      },
    );
    analytics.initialize("tagium");
    await Promise.resolve();
    await Promise.resolve();
    const shareId = "a".repeat(43);

    analytics.capture({
      type: "share_created",
      shareId,
      shareKind: "album",
      trackCount: 4,
      contentTitle: "Blossoms",
    });
    analytics.capture({
      type: "share_updated",
      shareId,
      shareKind: "album",
      trackCount: 4,
      contentTitle: `${"h".repeat(200)}\nprivate suffix`,
    });
    analytics.capture({
      type: "share_opened",
      shareId,
      shareKind: "album",
      trackCount: 4,
      viewer: "recipient",
    });
    analytics.capture({
      type: "share_added",
      shareId,
      shareKind: "album",
      trackCount: 4,
    });

    expect(capture.mock.calls).toEqual([
      [
        "share_created",
        expect.objectContaining({
          share_id: shareId,
          share_kind: "album",
          track_count: 4,
          content_title: "Blossoms",
        }),
      ],
      [
        "share_updated",
        expect.objectContaining({
          share_id: shareId,
          share_kind: "album",
          track_count: 4,
          content_title: "h".repeat(200),
        }),
      ],
      [
        "share_opened",
        expect.objectContaining({
          share_id: shareId,
          share_kind: "album",
          track_count: 4,
          viewer: "recipient",
        }),
      ],
      [
        "share_added",
        expect.objectContaining({ share_id: shareId, share_kind: "album", track_count: 4 }),
      ],
    ]);
    expect(JSON.stringify(capture.mock.calls)).not.toContain("k7m4q2");
    expect(JSON.stringify(capture.mock.calls)).not.toContain("/share/");
  });

  it("serializes URL shape and tunnel readiness as privacy-safe categories", async () => {
    const init = vi.fn();
    const capture = vi.fn();
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => ({ init, capture }),
        schedule: (load) => load(),
      },
    );
    analytics.initialize("tagium");
    await Promise.resolve();
    await Promise.resolve();

    const linkCases = [
      ["https://youtube.com/watch?v=private-id", "youtube", "canonical"],
      ["https://youtu.be/private-id", "youtube", "short"],
      ["https://music.youtube.com/watch?v=private-id", "youtube", "mobile"],
      ["https://www.youtube-nocookie.com/embed/private-id", "youtube", "nocookie"],
      ["https://on.soundcloud.com/private-token", "soundcloud", "short"],
      ["https://foo.youtube.com/private-id", "other", "other"],
      ["https://youtube.com.evil/private-id", "other", "other"],
    ] as const;

    for (const [sourceUrl, provider, linkForm] of linkCases) {
      analytics.capture({
        type: "media_link_processed",
        sourceUrl,
        mediaKind: "track",
        linkKind: linkForm,
        normalized: linkForm !== "canonical",
        redirected: linkForm === "short",
        outcome: "accepted",
      });
      expect(capture.mock.calls.at(-1)).toEqual([
        "media_link_processed",
        expect.objectContaining({
          provider,
          media_kind: "track",
          ["shape"]: linkForm,
          normalized: linkForm !== "canonical",
          redirected: linkForm === "short",
          outcome: "accepted",
        }),
      ]);
    }

    analytics.capture({
      type: "media_link_processed",
      sourceUrl: "https://on.soundcloud.com/private-token",
      mediaKind: "unsupported",
      linkKind: "short",
      normalized: false,
      redirected: false,
      outcome: "rejected",
      failureReason: "resolution_failed",
    });
    analytics.capture({
      type: "cobalt_tunnel_readiness",
      sourceUrl: "https://soundcloud.com/private-artist/private-track?secret=query",
      outcome: "recovered",
      attempts: 3,
      elapsedBucket: "1_to_5_seconds",
    });
    analytics.capture({
      type: "cobalt_tunnel_readiness",
      sourceUrl: "https://soundcloud.com/private-artist/private-track",
      outcome: "exhausted",
      attempts: 7,
      elapsedBucket: "5_to_15_seconds",
    });

    expect(capture.mock.calls.at(-3)?.[1]).toEqual(
      expect.objectContaining({
        provider: "soundcloud",
        failure_reason: "resolution_failed",
      }),
    );
    expect(capture.mock.calls.at(-2)).toEqual([
      "cobalt_tunnel_readiness",
      expect.objectContaining({
        provider: "soundcloud",
        outcome: "recovered",
        attempts: 3,
        elapsed_bucket: "1_to_5_seconds",
      }),
    ]);
    expect(capture.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({ outcome: "exhausted", attempts: 7 }),
    );

    const serialized = JSON.stringify(capture.mock.calls);
    for (const sensitiveValue of [
      "private-id",
      "private-token",
      "private-artist",
      "private-track",
      "secret",
      "query",
      "youtube.com.evil",
      "foo.youtube.com",
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }

    const options = init.mock.calls[0]?.[1] as AnalyticsInitOptions;
    const redacted = options.before_send({
      uuid: "capture-uuid",
      event: "cobalt_tunnel_readiness",
      properties: {
        event_version: 1,
        deploy_env: "production",
        provider: "https://soundcloud.com/private-track",
        outcome: "private-title",
        attempts: 999,
        elapsed_bucket: "request-signature",
        source_url: "https://soundcloud.com/private-track",
        request_id: "private-request-id",
        machine_id: "private-machine-id",
        tunnel_signature: "private-signature",
      },
    });

    expect(redacted?.properties).toEqual({
      event_version: 1,
      deploy_env: "production",
      app_id: "tagium",
    });
  });

  it("serializes and validates the Tagium Save download lifecycle", async () => {
    const init = vi.fn();
    const capture = vi.fn();
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => ({ init, capture }),
        schedule: (load) => load(),
      },
    );
    analytics.initialize("tagium-save");
    await Promise.resolve();
    await Promise.resolve();
    const sourceUrl = "https://youtube.com/watch?v=private-video-id";

    analytics.capture({
      type: "download_started",
      sourceUrl,
      requestedMode: "auto",
      requestedVideoQuality: "1080",
      requestedContainer: "mp4",
      requestedCodec: "h264",
      requestedAudioFormat: "best",
      isRetry: true,
    });
    analytics.capture({
      type: "download_resolved",
      sourceUrl,
      resultKind: "picker",
      resourceCount: 3,
    });
    analytics.capture({
      type: "download_finished",
      sourceUrl,
      outcome: "completed",
      durationMs: 1_500,
      outputFormat: "mp4",
      sizeBytes: 42 * 1024 * 1024,
    });
    analytics.capture({
      type: "download_finished",
      sourceUrl,
      outcome: "failed",
      durationMs: 800,
      failureStage: "tunnel",
      failureCode: "unsupported_source",
    });
    analytics.capture({
      type: "download_finished",
      sourceUrl,
      outcome: "canceled",
      durationMs: 300,
    });

    expect(capture.mock.calls).toEqual([
      [
        "download_started",
        expect.objectContaining({
          app_id: "tagium-save",
          provider: "youtube",
          requested_mode: "auto",
          requested_video_quality: "1080",
          requested_container: "mp4",
          requested_codec: "h264",
          requested_audio_format: "best",
          is_retry: true,
        }),
      ],
      [
        "download_resolved",
        expect.objectContaining({
          app_id: "tagium-save",
          provider: "youtube",
          result_kind: "picker",
          resource_count: 3,
        }),
      ],
      [
        "download_finished",
        expect.objectContaining({
          app_id: "tagium-save",
          provider: "youtube",
          outcome: "completed",
          duration_ms: 1_500,
          output_format: "mp4",
          size_bucket: "10_to_100_mb",
        }),
      ],
      [
        "download_finished",
        expect.objectContaining({
          app_id: "tagium-save",
          provider: "youtube",
          outcome: "failed",
          duration_ms: 800,
          failure_stage: "tunnel",
          failure_code: "unsupported_source",
        }),
      ],
      [
        "download_finished",
        expect.objectContaining({
          app_id: "tagium-save",
          provider: "youtube",
          outcome: "canceled",
          duration_ms: 300,
        }),
      ],
    ]);

    const options = init.mock.calls[0]?.[1] as AnalyticsInitOptions;
    const redacted = options.before_send({
      uuid: "download-uuid",
      event: "download_started",
      properties: {
        provider: "youtube",
        requested_mode: "audio",
        requested_video_quality: "2160",
        requested_container: "mp4",
        requested_codec: "private-codec",
        requested_audio_format: "opus",
        is_retry: false,
        source_url: sourceUrl,
        filename: "private-filename.mp4",
        error_message: "private upstream response",
        cobalt_code: "private-code",
      },
    });

    expect(redacted).toEqual({
      uuid: "download-uuid",
      event: "download_started",
      properties: {
        provider: "youtube",
        requested_mode: "audio",
        requested_container: "mp4",
        requested_audio_format: "opus",
        is_retry: false,
        app_id: "tagium-save",
      },
    });
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private-video-id");
  });

  it("serializes typed import failure categories without private details", async () => {
    const capture = vi.fn();
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => ({ init: vi.fn(), capture }),
        schedule: (load) => load(),
      },
    );
    analytics.initialize("tagium");
    await Promise.resolve();
    await Promise.resolve();

    analytics.capture({
      type: "import_failure_category",
      sourceUrl: "https://soundcloud.com/private-path",
      importKind: "set",
      stage: "tunnel",
      code: "empty_response",
      trackCount: 2,
    });

    expect(capture.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        provider: "soundcloud",
        import_kind: "set",
        stage: "tunnel",
        code: "empty_response",
        track_count: 2,
      }),
    );

    const payloads = JSON.stringify(capture.mock.calls);
    expect(payloads).not.toContain("private");
    expect(payloads).not.toContain("soundcloud.com");
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

    analytics.initialize("tagium");
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
        cookieless_mode: "always",
        person_profiles: "never",
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
    analytics.initialize("tagium");
    await Promise.resolve();
    await Promise.resolve();

    const options = init.mock.calls[0]?.[1] as AnalyticsInitOptions;
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
      uuid: "capture-uuid",
      event: "$pageview",
      properties: {
        $browser: "Chrome",
        $user_agent: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36",
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
        app_id: "tagium",
      },
    });
    expect(pageview).toEqual({
      uuid: "capture-uuid",
      event: "$pageview",
      properties: {
        $browser: "Chrome",
        $user_agent: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36",
        app_id: "tagium",
      },
    });
    expect(
      options.before_send({
        uuid: "capture-uuid",
        event: "made_up_event",
        properties: { private: "value" },
      }),
    ).toBeNull();
    expect(
      options.before_send({
        uuid: "capture-uuid",
        event: "import_failure_category",
        properties: {
          provider: "soundcloud",
          import_kind: "set",
          stage: "private-url",
          code: "private-request-id",
          track_count: 1,
        },
      }),
    ).toEqual({
      uuid: "capture-uuid",
      event: "import_failure_category",
      properties: {
        provider: "soundcloud",
        import_kind: "set",
        track_count: 1,
        app_id: "tagium",
      },
    });
    expect(
      options.before_send({
        uuid: "capture-uuid",
        event: "share_opened",
        properties: {
          share_id: "a".repeat(43),
          share_kind: "album",
          track_count: 4,
          viewer: "recipient",
          share_slug: "k7m4q2",
        },
      }),
    ).toEqual({
      uuid: "capture-uuid",
      event: "share_opened",
      properties: {
        share_id: "a".repeat(43),
        share_kind: "album",
        track_count: 4,
        viewer: "recipient",
        app_id: "tagium",
      },
    });
    expect(
      options.before_send({
        uuid: "capture-uuid",
        event: "share_opened",
        properties: { share_id: "k7m4q2", share_kind: "album", track_count: 4 },
      }),
    ).toEqual({
      uuid: "capture-uuid",
      event: "share_opened",
      properties: { share_kind: "album", track_count: 4, app_id: "tagium" },
    });
    expect(
      options.before_send({
        uuid: "capture-uuid",
        event: "import_retry_finished",
        properties: {
          provider: "mixed",
          retry_count: 2,
          completed_count: 1,
          failed_count: 0,
          canceled_count: 0,
        },
      }),
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
    analytics.initialize("tagium");
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
    analytics.initialize("tagium");

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
    analytics.initialize("tagium");
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
      sourceUrl: "https://soundcloud.com/private-artist/private-track",
      outputFormat: "zip",
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
          provider: "soundcloud",
          output_format: "zip",
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
    analytics.initialize("tagium");
    await Promise.resolve();
    await Promise.resolve();

    analytics.capture({
      type: "settings_changed",
      syncFilenames: false,
      audioBitrate: "256",
      audioFormat: "best",
      applySoundCloudCover: true,
      advancedMetadata: true,
      metadataLinks: {
        singleAlbum: false,
        artist: true,
        year: false,
        genre: true,
        artwork: false,
        albumArtist: true,
        trackNumber: true,
        filename: false,
      },
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
    analytics.capture({
      type: "import_retry_finished",
      provider: "youtube",
      retryCount: 3,
      completedCount: 1,
      failedCount: 1,
      canceledCount: 1,
      outcome: "canceled",
      durationMs: 400,
    });

    expect(capture.mock.calls.map(([name, properties]) => [name, properties])).toEqual([
      [
        "settings_changed",
        expect.objectContaining({
          sync_filenames: false,
          audio_bitrate: "256",
          apply_soundcloud_cover: true,
          advanced_metadata: true,
          link_single_album: false,
          link_artist: true,
          link_year: false,
          link_genre: true,
          link_artwork: false,
          link_album_artist: true,
          sync_track_numbers: true,
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
      [
        "import_retry_finished",
        expect.objectContaining({
          provider: "youtube",
          retry_count: 3,
          completed_count: 1,
          failed_count: 1,
          canceled_count: 1,
          outcome: "canceled",
          duration_ms: 400,
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
    analytics.initialize("tagium");
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
