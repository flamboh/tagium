import { describe, expect, it, vi } from "vite-plus/test";
import type { BeforeSendFn } from "posthog-js";
import { createAnalytics } from "@/analytics";

type AnalyticsInitOptions = { before_send: BeforeSendFn };
type AppId = "tagium" | "tagium-save";

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createLoadedAnalytics = async (appId: AppId = "tagium") => {
  const init = vi.fn();
  const capture = vi.fn();
  const analytics = createAnalytics(
    {
      key: "public-test-key",
      host: "https://us.i.posthog.com",
      deployEnv: "production",
      releaseSha: "release-sha",
    },
    {
      loadClient: async () => ({ init, capture }),
      schedule: (load) => load(),
    },
  );
  analytics.initialize(appId);
  await settle();
  return { analytics, init, capture };
};

describe("analytics", () => {
  it("does no work outside production", () => {
    const loadClient = vi.fn();
    const schedule = vi.fn();
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "preview" },
      { loadClient, schedule },
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

    expect(schedule).not.toHaveBeenCalled();
    expect(loadClient).not.toHaveBeenCalled();
  });

  it("flushes queued events with app and release context when the client loads", async () => {
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
      requestedCount: 2,
      acceptedCount: 1,
      duplicateCount: 1,
      parseRejectedCount: 0,
      targetKind: "album",
    });
    expect(capture).not.toHaveBeenCalled();

    scheduledLoad?.();
    await settle();

    expect(init).toHaveBeenCalledWith(
      "public-test-key",
      expect.objectContaining({
        api_host: "https://t.tagium.app",
        ui_host: "https://us.posthog.com",
      }),
    );
    expect(capture).toHaveBeenCalledWith(
      "audio_upload_completed",
      expect.objectContaining({
        app_id: "tagium",
        deploy_env: "production",
        release_sha: "release-sha",
        requested_count: 2,
        target_kind: "album",
      }),
    );
  });

  it("allowlists providers and never serializes source URLs", async () => {
    const { analytics, capture } = await createLoadedAnalytics();
    analytics.capture({
      type: "media_link_processed",
      sourceUrl: "https://music.youtube.com/watch?v=private-id",
      mediaKind: "track",
      linkKind: "canonical",
      normalized: false,
      redirected: false,
      outcome: "accepted",
    });
    analytics.capture({
      type: "import_started",
      sourceUrl: "https://youtube.com.evil/private-track",
      importKind: "single",
    });

    expect(capture.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ provider: "youtube", media_kind: "track" }),
    );
    expect(capture.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ provider: "other" }));
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private-id");
    expect(JSON.stringify(capture.mock.calls)).not.toContain("youtube.com.evil");
  });

  it("serializes one privacy-safe share lifecycle", async () => {
    const { analytics, capture } = await createLoadedAnalytics();
    const shareId = "a".repeat(43);
    analytics.capture({
      type: "share_created",
      shareId,
      shareKind: "album",
      trackCount: 2,
      contentTitle: "Night\nDrive",
    });
    analytics.capture({ type: "share_added", shareId, shareKind: "album", trackCount: 2 });
    analytics.capture({
      type: "share_opened",
      shareId,
      shareKind: "album",
      trackCount: 2,
      viewer: "recipient",
    });

    expect(capture.mock.calls.map(([name]) => name)).toEqual([
      "share_created",
      "share_added",
      "share_opened",
    ]);
    expect(capture.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ share_id: shareId, content_title: "Night Drive" }),
    );
    expect(JSON.stringify(capture.mock.calls)).not.toContain("/share/");
  });

  it("carries requested format through import outcomes and rejects inconsistent counts", async () => {
    const { analytics, capture, init } = await createLoadedAnalytics();
    const sourceUrl = "https://soundcloud.com/private-artist/private-track";
    analytics.capture({
      type: "import_started",
      sourceUrl,
      importKind: "single",
      requestedFormat: "mp3",
    });
    analytics.capture({
      type: "import_finished",
      sourceUrl,
      importKind: "single",
      requestedFormat: "mp3",
      outcome: "completed",
      totalCount: 1,
      completedCount: 1,
      failedCount: 0,
      canceledCount: 0,
      durationMs: 250,
    });
    analytics.capture({
      type: "import_failure_category",
      sourceUrl,
      importKind: "single",
      requestedFormat: "mp3",
      stage: "processing",
      code: "parse_failed",
      trackCount: 1,
    });

    expect(capture.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ provider: "soundcloud", requested_format: "mp3" }),
    );
    expect(capture.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ outcome: "completed", total_count: 1, completed_count: 1 }),
    );
    expect(capture.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({ stage: "processing", code: "parse_failed" }),
    );
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private-artist");

    const options = init.mock.calls[0]?.[1] as AnalyticsInitOptions;
    expect(
      options.before_send({
        uuid: "invalid-counts",
        event: "import_finished",
        properties: {
          provider: "soundcloud",
          import_kind: "single",
          outcome: "completed",
          total_count: 2,
          completed_count: 1,
          failed_count: 0,
          canceled_count: 0,
          duration_ms: 1,
        },
      }),
    ).toBeNull();
  });

  it("serializes Tagium Save outcomes and strips invalid or private fields", async () => {
    const { analytics, capture, init } = await createLoadedAnalytics("tagium-save");
    const sourceUrl = "https://youtube.com/watch?v=private-video-id";
    analytics.capture({
      type: "download_started",
      sourceUrl,
      requestedMode: "auto",
      requestedVideoQuality: "1080",
      requestedContainer: "mp4",
      requestedCodec: "h264",
      requestedAudioFormat: "best",
      isRetry: false,
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

    expect(capture.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ app_id: "tagium-save", provider: "youtube", is_retry: false }),
    );
    expect(capture.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        outcome: "completed",
        output_format: "mp4",
        size_bucket: "10_to_100_mb",
      }),
    );
    expect(capture.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        outcome: "failed",
        failure_stage: "tunnel",
        failure_code: "unsupported_source",
      }),
    );

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
        is_retry: true,
        source_url: sourceUrl,
        filename: "private-file.mp4",
      },
    });
    expect(redacted?.properties).toEqual({
      provider: "youtube",
      requested_mode: "audio",
      requested_container: "mp4",
      requested_audio_format: "opus",
      is_retry: true,
      app_id: "tagium-save",
    });
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private-video-id");
  });

  it("serializes export milestones and durable metadata failures", async () => {
    const { analytics, capture } = await createLoadedAnalytics();
    analytics.capture({
      type: "export_started",
      exportKind: "library",
      trackCount: 3,
      albumCount: 1,
    });
    analytics.capture({
      type: "export_prepared",
      exportKind: "library",
      trackCount: 3,
      albumCount: 1,
      sizeBytes: 12 * 1024 * 1024,
      sourceUrl: "https://soundcloud.com/private-artist/private-track",
      outputFormat: "zip",
    });
    analytics.capture({
      type: "export_failed",
      exportKind: "library",
      error: new Error("metadata write failed for private filename"),
    });

    expect(capture.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ export_kind: "library", track_count: 3 }),
    );
    expect(capture.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        provider: "soundcloud",
        output_format: "zip",
        size_bucket: "10_to_100_mb",
      }),
    );
    expect(capture.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({ error_code: "metadata_write_failed" }),
    );
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private");
  });

  it("configures PostHog for privacy and filters unknown transport properties", async () => {
    const { init } = await createLoadedAnalytics();
    const options = init.mock.calls[0]?.[1] as AnalyticsInitOptions;
    expect(init).toHaveBeenCalledWith(
      "public-test-key",
      expect.objectContaining({
        capture_pageview: "history_change",
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

    const sanitized = options.before_send({
      uuid: "capture-uuid",
      event: "audio_upload_completed",
      properties: {
        event_version: 1,
        deploy_env: "production",
        target_kind: "loose",
        $browser: "Chrome",
        source_url: "https://soundcloud.com/private-path",
        error_message: "private response",
        unexpected_property: "private metadata",
      },
    });
    expect(sanitized?.properties).toEqual({
      event_version: 1,
      deploy_env: "production",
      target_kind: "loose",
      $browser: "Chrome",
      app_id: "tagium",
    });
    expect(
      options.before_send({
        uuid: "unknown-event",
        event: "made_up_event",
        properties: { private: "value" },
      }),
    ).toBeNull();
  });

  it("preserves the SDK properties PostHog requires for cookieless identity", async () => {
    const init = vi.fn();
    const analytics = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => ({ init, capture: vi.fn() }),
        schedule: (load) => load(),
      },
    );
    analytics.initialize("tagium-save");
    await Promise.resolve();
    await Promise.resolve();

    const options = init.mock.calls[0]?.[1] as AnalyticsInitOptions;
    expect(
      options.before_send({
        uuid: "download-uuid",
        event: "download_finished",
        properties: {
          provider: "youtube",
          outcome: "completed",
          duration_ms: 1_500,
          output_format: "mp4",
          size_bucket: "10_to_100_mb",
          $raw_user_agent: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36",
          $cookieless_mode: true,
          $host: "SAVE.TAGIUM.APP",
        },
      }),
    ).toEqual({
      uuid: "download-uuid",
      event: "download_finished",
      properties: {
        provider: "youtube",
        outcome: "completed",
        duration_ms: 1_500,
        output_format: "mp4",
        size_bucket: "10_to_100_mb",
        $raw_user_agent: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36",
        $cookieless_mode: true,
        $host: "save.tagium.app",
        app_id: "tagium-save",
      },
    });

    const botUserAgent = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    expect(
      options.before_send({
        uuid: "pageview-uuid",
        event: "$pageview",
        properties: {
          $raw_user_agent: botUserAgent,
          $cookieless_mode: true,
          $host: "https://save.tagium.app/path",
        },
      }),
    ).toEqual({
      uuid: "pageview-uuid",
      event: "$pageview",
      properties: {
        $raw_user_agent: botUserAgent,
        $cookieless_mode: true,
        app_id: "tagium-save",
      },
    });

    for (const untrustedHost of ["tagium.app", "", "evil.example"]) {
      expect(
        options.before_send({
          uuid: "untrusted-host-uuid",
          event: "$pageview",
          properties: { $cookieless_mode: true, $host: untrustedHost },
        }),
      ).toEqual({
        uuid: "untrusted-host-uuid",
        event: "$pageview",
        properties: { $cookieless_mode: true, app_id: "tagium-save" },
      });
    }

    expect(
      options.before_send({
        uuid: "non-cookieless-uuid",
        event: "$pageview",
        properties: { $raw_user_agent: botUserAgent, $host: "save.tagium.app" },
      }),
    ).toEqual({
      uuid: "non-cookieless-uuid",
      event: "$pageview",
      properties: { app_id: "tagium-save" },
    });
  });

  it("fails open when the provider or its initial load fails", async () => {
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
    await settle();
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

    let attempts = 0;
    const retriedCapture = vi.fn();
    const retried = createAnalytics(
      { key: "public-test-key", deployEnv: "production" },
      {
        loadClient: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("blocked SDK request");
          return { init: vi.fn(), capture: retriedCapture };
        },
        schedule: (load) => load(),
      },
    );
    retried.initialize("tagium");
    retried.capture({
      type: "audio_upload_completed",
      requestedCount: 1,
      acceptedCount: 1,
      duplicateCount: 0,
      parseRejectedCount: 0,
      targetKind: "loose",
    });
    await settle();
    retried.capture({
      type: "audio_upload_completed",
      requestedCount: 2,
      acceptedCount: 2,
      duplicateCount: 0,
      parseRejectedCount: 0,
      targetKind: "loose",
    });
    await settle();
    expect(attempts).toBe(2);
    expect(retriedCapture).toHaveBeenCalledTimes(2);
  });

  it("bounds events queued before the SDK is ready", async () => {
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
    await settle();

    expect(capture).toHaveBeenCalledTimes(100);
    expect(capture.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ requested_count: 2 }));
    expect(capture.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({ requested_count: 101 }),
    );
  });
});
