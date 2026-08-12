export type AudioUploadTargetKind = "loose" | "album";
export type ImportKind = "single" | "set";
export type ImportOutcome = "completed" | "partial" | "failed" | "canceled";
export type ExportKind = "track" | "album" | "library";
export type TrackSourceMix = "local" | "imported" | "mixed" | "unknown";
export type AnalyticsProvider = "youtube" | "soundcloud" | "other";
export type AnalyticsProviderScope = AnalyticsProvider | "mixed";
export type ImportFailureStage = "plan" | "tunnel" | "processing" | "hydration";
export type ImportFailureCode =
  | "capacity"
  | "rate_limited"
  | "service_unavailable"
  | "timeout"
  | "fetch_failed"
  | "empty_response"
  | "parse_failed"
  | "metadata_write_failed"
  | "unknown";
export type MediaLinkShape = "canonical" | "short" | "mobile" | "nocookie" | "other";
export type CobaltTunnelOutcome = "ready" | "recovered" | "exhausted" | "non_retryable";
export type CobaltTunnelElapsedBucket =
  | "under_1_second"
  | "1_to_5_seconds"
  | "5_to_15_seconds"
  | "15_seconds_or_more";
export type AnalyticsErrorCode =
  | "capacity"
  | "rate_limited"
  | "service_unavailable"
  | "timeout"
  | "parse_failed"
  | "metadata_write_failed"
  | "unknown";

export type AnalyticsEvent =
  | {
      type: "audio_upload_completed";
      requestedCount: number;
      acceptedCount: number;
      duplicateCount: number;
      parseRejectedCount: number;
      targetKind: AudioUploadTargetKind;
    }
  | {
      type: "media_link_processed";
      sourceUrl: string;
      mediaKind: "track" | "playlist" | "unsupported";
      shape: MediaLinkShape;
      normalized: boolean;
      redirected: boolean;
      outcome: "accepted" | "rejected";
      failureReason?: "invalid" | "unsupported" | "resolution_failed";
    }
  | {
      type: "cobalt_tunnel_readiness";
      sourceUrl: string;
      outcome: CobaltTunnelOutcome;
      attempts: number;
      elapsedBucket: CobaltTunnelElapsedBucket;
    }
  | {
      type: "import_started";
      sourceUrl: string;
      importKind: ImportKind;
    }
  | {
      type: "import_resolved";
      sourceUrl: string;
      importKind: ImportKind;
      resolvedCount: number;
      hasCover: boolean;
    }
  | {
      type: "import_finished";
      sourceUrl: string;
      importKind: ImportKind;
      outcome: ImportOutcome;
      totalCount: number;
      completedCount: number;
      failedCount: number;
      canceledCount: number;
      durationMs: number;
    }
  | {
      type: "import_resolution_failed";
      sourceUrl: string;
      importKind: ImportKind;
      code: ImportFailureCode;
    }
  | {
      type: "import_failure_category";
      sourceUrl: string;
      importKind: ImportKind;
      stage: ImportFailureStage;
      code: ImportFailureCode;
      trackCount: number;
    }
  | {
      type: "export_started";
      exportKind: ExportKind;
      trackCount: number;
      albumCount?: number;
    }
  | {
      type: "export_prepared";
      exportKind: ExportKind;
      trackCount: number;
      albumCount?: number;
      sizeBytes: number;
    }
  | {
      type: "export_failed";
      exportKind: ExportKind;
      error: unknown;
    }
  | {
      type: "settings_changed";
      syncFilenames: boolean;
      audioBitrate: "320" | "256" | "128" | "96" | "64";
      applySoundCloudCover: boolean;
      advancedMetadata: boolean;
      metadataLinks: MetadataLinkState;
    }
  | {
      type: "album_created" | "album_edited";
      trackCount: number;
      hasCover: boolean;
    }
  | {
      type: "tracks_removed";
      trackCount: number;
      sourceMix: TrackSourceMix;
    }
  | {
      type: "import_cancel_requested";
      totalCount: number;
      completedCount: number;
      activeCount: number;
      pendingCount: number;
    }
  | {
      type: "import_retry_started";
      provider: AnalyticsProviderScope;
      retryCount: number;
      previousFailedCount: number;
      previousCanceledCount: number;
    }
  | {
      type: "import_retry_finished";
      provider: AnalyticsProviderScope;
      retryCount: number;
      completedCount: number;
      failedCount: number;
      canceledCount: number;
      outcome: ImportOutcome;
      durationMs: number;
    }
  | {
      type: "share_created" | "share_added";
      shareId: string;
      shareKind: "album" | "track";
      trackCount: number;
    }
  | {
      type: "share_opened";
      shareId: string;
      shareKind: "album" | "track";
      trackCount: number;
      viewer: "creator" | "recipient";
    };

export interface AnalyticsConfig {
  key?: string;
  host?: string;
  deployEnv?: string;
  releaseSha?: string;
}

interface AnalyticsClient {
  init: (key: string, options: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
}

interface AnalyticsDependencies {
  loadClient: () => Promise<AnalyticsClient>;
  schedule: (load: () => void) => void;
}

const MAX_QUEUED_EVENTS = 100;

export interface Analytics {
  initialize: () => void;
  capture: (event: AnalyticsEvent) => void;
}

export const analyticsProviderFromUrl = (sourceUrl: string): AnalyticsProvider => {
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.toLowerCase();
    if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
      ].includes(host)
    )
      return "youtube";
    if (
      [
        "soundcloud.com",
        "www.soundcloud.com",
        "m.soundcloud.com",
        "on.soundcloud.com",
        "snd.sc",
      ].includes(host)
    )
      return "soundcloud";
  } catch {
    // Invalid and non-web URLs are intentionally grouped with other providers.
  }
  return "other";
};

const errorCodeFrom = (error: unknown): AnalyticsErrorCode => {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("error.api.capacity_exceeded")) return "capacity";
  if (
    message.includes("error.api.rate_exceeded") ||
    message.includes("Cobalt tunnel request failed (429)") ||
    /\b429\b/.test(message)
  ) {
    return "rate_limited";
  }
  if (
    message.includes("error.api.unreachable") ||
    message.includes("COBALT_API_URL is not configured")
  ) {
    return "service_unavailable";
  }
  if (message.includes("error.api.timed_out") || /\btimed?\s*out\b/i.test(message)) {
    return "timeout";
  }
  if (/could not be parsed|decode|metadata read/i.test(message)) return "parse_failed";
  if (/metadata.*(?:write|appl)|write.*metadata/i.test(message)) return "metadata_write_failed";
  return "unknown";
};

type BeforeSendEvent = {
  uuid?: string;
  event: string;
  properties: Record<string, unknown>;
  timestamp?: Date;
};

const COMMON_CUSTOM_PROPERTIES = ["event_version", "deploy_env", "release_sha"];
const CUSTOM_EVENT_PROPERTIES: Record<string, ReadonlySet<string>> = {
  media_link_processed: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "media_kind",
    "shape",
    "normalized",
    "redirected",
    "outcome",
    "failure_reason",
  ]),
  cobalt_tunnel_readiness: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "outcome",
    "attempts",
    "elapsed_bucket",
  ]),
  audio_upload_completed: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "requested_count",
    "accepted_count",
    "duplicate_count",
    "parse_rejected_count",
    "target_kind",
  ]),
  import_started: new Set([...COMMON_CUSTOM_PROPERTIES, "provider", "import_kind"]),
  import_resolved: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "import_kind",
    "resolved_count",
    "has_cover",
  ]),
  import_finished: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "import_kind",
    "outcome",
    "total_count",
    "completed_count",
    "failed_count",
    "canceled_count",
    "duration_ms",
  ]),
  import_failure_category: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "import_kind",
    "stage",
    "code",
    "track_count",
  ]),
  import_resolution_failed: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "import_kind",
    "code",
  ]),
  export_started: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "export_kind",
    "track_count",
    "album_count",
  ]),
  export_prepared: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "export_kind",
    "track_count",
    "album_count",
    "size_bucket",
  ]),
  export_failed: new Set([...COMMON_CUSTOM_PROPERTIES, "export_kind", "error_code"]),
  settings_changed: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "sync_track_numbers",
    "sync_filenames",
    "audio_bitrate",
    "apply_soundcloud_cover",
    "advanced_metadata",
    ...METADATA_LINK_DESCRIPTORS.map((descriptor) => descriptor.analyticsProperty),
  ]),
  album_created: new Set([...COMMON_CUSTOM_PROPERTIES, "track_count", "has_cover"]),
  album_edited: new Set([...COMMON_CUSTOM_PROPERTIES, "track_count", "has_cover"]),
  tracks_removed: new Set([...COMMON_CUSTOM_PROPERTIES, "track_count", "source_mix"]),
  import_cancel_requested: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "total_count",
    "completed_count",
    "active_count",
    "pending_count",
  ]),
  import_retry_started: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "retry_count",
    "previous_failed_count",
    "previous_canceled_count",
  ]),
  import_retry_finished: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "retry_count",
    "completed_count",
    "failed_count",
    "canceled_count",
    "outcome",
    "duration_ms",
  ]),
  share_created: new Set([...COMMON_CUSTOM_PROPERTIES, "share_id", "share_kind", "track_count"]),
  share_opened: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "share_id",
    "share_kind",
    "track_count",
    "viewer",
  ]),
  share_added: new Set([...COMMON_CUSTOM_PROPERTIES, "share_id", "share_kind", "track_count"]),
};
const SAFE_SDK_EVENTS = new Set(["$pageview", "$pageleave", "$autocapture"]);
const SAFE_SDK_PROPERTIES = new Set([
  "token",
  "distinct_id",
  "$device_id",
  "$session_id",
  "$window_id",
  "$pageview_id",
  "$insert_id",
  "$time",
  "$sent_at",
  "$lib",
  "$lib_version",
  "$user_agent",
  "$browser",
  "$browser_version",
  "$os",
  "$os_version",
  "$device_type",
  "$screen_height",
  "$screen_width",
  "$viewport_height",
  "$viewport_width",
  "$timezone",
  "$timezone_offset",
  "$event_type",
  "$prev_pageview_duration",
  "$process_person_profile",
  "$geoip_disable",
]);
const SENSITIVE_PROPERTY_NAME =
  /(?:url|href|referrer|pathname|host|filename|artist|album|artwork|message|response|body|tunnel|text|elements)/i;
const URL_VALUE = /https?:\/\//i;
const isOneOf =
  <Value extends string>(values: readonly Value[]) =>
  (value: unknown): value is Value =>
    typeof value === "string" && values.includes(value as Value);
const isBoolean = (value: unknown) => typeof value === "boolean";
const isBoundedTunnelAttempt = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7;
const isAnalyticsProvider = isOneOf(["youtube", "soundcloud", "other"] as const);
const isAnalyticsProviderScope = isOneOf(["youtube", "soundcloud", "other", "mixed"] as const);
const isImportKind = isOneOf(["single", "set"] as const);
const isImportOutcome = isOneOf(["completed", "partial", "failed", "canceled"] as const);
const isImportFailureStage = isOneOf(["plan", "tunnel", "processing", "hydration"] as const);
const isImportFailureCode = isOneOf([
  "capacity",
  "rate_limited",
  "service_unavailable",
  "timeout",
  "fetch_failed",
  "empty_response",
  "parse_failed",
  "metadata_write_failed",
  "unknown",
] as const);
const isNonNegativeInteger = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const isPositiveInteger = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value > 0;
const isNonNegativeNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isMediaKind = isOneOf(["track", "playlist", "unsupported"] as const);
const isMediaLinkShape = isOneOf(["canonical", "short", "mobile", "nocookie", "other"] as const);
const isMediaLinkOutcome = isOneOf(["accepted", "rejected"] as const);
const isMediaLinkFailure = isOneOf(["invalid", "unsupported", "resolution_failed"] as const);
const isCobaltTunnelOutcome = isOneOf([
  "ready",
  "recovered",
  "exhausted",
  "non_retryable",
] as const);
const isCobaltTunnelElapsedBucket = isOneOf([
  "under_1_second",
  "1_to_5_seconds",
  "5_to_15_seconds",
  "15_seconds_or_more",
] as const);
const isShareKind = isOneOf(["album", "track"] as const);
const isShareViewer = isOneOf(["creator", "recipient"] as const);

const CUSTOM_PROPERTY_VALIDATORS: Record<
  string,
  Readonly<Record<string, (value: unknown) => boolean>>
> = {
  media_link_processed: {
    provider: isAnalyticsProvider,
    media_kind: isMediaKind,
    shape: isMediaLinkShape,
    normalized: isBoolean,
    redirected: isBoolean,
    outcome: isMediaLinkOutcome,
    failure_reason: isMediaLinkFailure,
  },
  cobalt_tunnel_readiness: {
    provider: isAnalyticsProvider,
    outcome: isCobaltTunnelOutcome,
    attempts: isBoundedTunnelAttempt,
    elapsed_bucket: isCobaltTunnelElapsedBucket,
  },
  import_finished: {
    provider: isAnalyticsProvider,
    import_kind: isImportKind,
    outcome: isImportOutcome,
    total_count: isNonNegativeInteger,
    completed_count: isNonNegativeInteger,
    failed_count: isNonNegativeInteger,
    canceled_count: isNonNegativeInteger,
    duration_ms: isNonNegativeNumber,
  },
  import_failure_category: {
    provider: isAnalyticsProvider,
    import_kind: isImportKind,
    stage: isImportFailureStage,
    code: isImportFailureCode,
    track_count: isPositiveInteger,
  },
  import_resolution_failed: {
    provider: isAnalyticsProvider,
    import_kind: isImportKind,
    code: isImportFailureCode,
  },
  import_retry_started: {
    provider: isAnalyticsProviderScope,
    retry_count: isPositiveInteger,
    previous_failed_count: isNonNegativeInteger,
    previous_canceled_count: isNonNegativeInteger,
  },
  import_retry_finished: {
    provider: isAnalyticsProviderScope,
    retry_count: isPositiveInteger,
    completed_count: isNonNegativeInteger,
    failed_count: isNonNegativeInteger,
    canceled_count: isNonNegativeInteger,
    outcome: isImportOutcome,
    duration_ms: isNonNegativeNumber,
  },
  share_created: {
    share_id: isShareAnalyticsId,
    share_kind: isShareKind,
    track_count: isPositiveInteger,
  },
  share_opened: {
    share_id: isShareAnalyticsId,
    share_kind: isShareKind,
    track_count: isPositiveInteger,
    viewer: isShareViewer,
  },
  share_added: {
    share_id: isShareAnalyticsId,
    share_kind: isShareKind,
    track_count: isPositiveInteger,
  },
};

const redactAndValidateEvent = (event: BeforeSendEvent): BeforeSendEvent | null => {
  const customAllowedProperties = CUSTOM_EVENT_PROPERTIES[event.event];
  const customPropertyValidators = CUSTOM_PROPERTY_VALIDATORS[event.event];
  const isSdkEvent = SAFE_SDK_EVENTS.has(event.event);
  if (!customAllowedProperties && !isSdkEvent) return null;

  const properties: Record<string, unknown> = {};
  for (const [property, value] of Object.entries(event.properties ?? {})) {
    const isAllowedCustomProperty = customAllowedProperties?.has(property) ?? false;
    const isAllowedSdkProperty = SAFE_SDK_PROPERTIES.has(property);
    if (!isAllowedCustomProperty && !isAllowedSdkProperty) continue;
    const customValidator = customPropertyValidators?.[property];
    if (customValidator && !customValidator(value)) continue;
    if (!isAllowedCustomProperty && SENSITIVE_PROPERTY_NAME.test(property)) continue;
    if (!isAllowedCustomProperty && typeof value === "string" && URL_VALUE.test(value)) continue;
    properties[property] = value;
  }

  if (event.event === "import_retry_finished" || event.event === "import_finished") {
    const expectedCount =
      event.event === "import_retry_finished" ? properties.retry_count : properties.total_count;
    const completedCount = properties.completed_count;
    const failedCount = properties.failed_count;
    const canceledCount = properties.canceled_count;
    if (
      typeof expectedCount !== "number" ||
      typeof completedCount !== "number" ||
      typeof failedCount !== "number" ||
      typeof canceledCount !== "number" ||
      completedCount + failedCount + canceledCount !== expectedCount
    ) {
      return null;
    }
  }

  if (isSdkEvent) properties.app_view = "tagium";
  return {
    ...(event.uuid === undefined ? {} : { uuid: event.uuid }),
    event: event.event,
    properties,
    ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
  };
};

const sizeBucket = (sizeBytes: number) => {
  const sizeMb = sizeBytes / (1024 * 1024);
  if (sizeMb < 10) return "under_10_mb";
  if (sizeMb < 100) return "10_to_100_mb";
  if (sizeMb < 500) return "100_to_500_mb";
  return "500_mb_or_more";
};

const serializeEvent = (event: AnalyticsEvent, config: AnalyticsConfig) => {
  const commonProperties = {
    event_version: 1,
    deploy_env: config.deployEnv,
    ...(config.releaseSha ? { release_sha: config.releaseSha } : {}),
  };

  switch (event.type) {
    case "media_link_processed": {
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          provider: analyticsProviderFromUrl(event.sourceUrl),
          media_kind: event.mediaKind,
          shape: event.shape,
          normalized: event.normalized,
          redirected: event.redirected,
          outcome: event.outcome,
          ...(event.failureReason ? { failure_reason: event.failureReason } : {}),
        },
      };
    }
    case "cobalt_tunnel_readiness": {
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          provider: analyticsProviderFromUrl(event.sourceUrl),
          outcome: event.outcome,
          attempts: Math.max(1, Math.min(7, Math.trunc(event.attempts))),
          elapsed_bucket: event.elapsedBucket,
        },
      };
    }
    case "audio_upload_completed":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          requested_count: event.requestedCount,
          accepted_count: event.acceptedCount,
          duplicate_count: event.duplicateCount,
          parse_rejected_count: event.parseRejectedCount,
          target_kind: event.targetKind,
        },
      };
    case "import_started":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          provider: analyticsProviderFromUrl(event.sourceUrl),
          import_kind: event.importKind,
        },
      };
    case "import_resolved":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          provider: analyticsProviderFromUrl(event.sourceUrl),
          import_kind: event.importKind,
          resolved_count: event.resolvedCount,
          has_cover: event.hasCover,
        },
      };
    case "import_finished":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          provider: analyticsProviderFromUrl(event.sourceUrl),
          import_kind: event.importKind,
          outcome: event.outcome,
          total_count: event.totalCount,
          completed_count: event.completedCount,
          failed_count: event.failedCount,
          canceled_count: event.canceledCount,
          duration_ms: event.durationMs,
        },
      };
    case "import_failure_category":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          provider: analyticsProviderFromUrl(event.sourceUrl),
          import_kind: event.importKind,
          stage: event.stage,
          code: event.code,
          track_count: event.trackCount,
        },
      };
    case "import_resolution_failed":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          provider: analyticsProviderFromUrl(event.sourceUrl),
          import_kind: event.importKind,
          code: event.code,
        },
      };
    case "export_started":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          export_kind: event.exportKind,
          track_count: event.trackCount,
          ...(event.albumCount === undefined ? {} : { album_count: event.albumCount }),
        },
      };
    case "export_prepared":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          export_kind: event.exportKind,
          track_count: event.trackCount,
          ...(event.albumCount === undefined ? {} : { album_count: event.albumCount }),
          size_bucket: sizeBucket(event.sizeBytes),
        },
      };
    case "export_failed":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          export_kind: event.exportKind,
          error_code: errorCodeFrom(event.error),
        },
      };
    case "settings_changed":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          audio_bitrate: event.audioBitrate,
          apply_soundcloud_cover: event.applySoundCloudCover,
          advanced_metadata: event.advancedMetadata,
          ...serializeMetadataLinkAnalytics(event.metadataLinks),
        },
      };
    case "album_created":
    case "album_edited":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          track_count: event.trackCount,
          has_cover: event.hasCover,
        },
      };
    case "tracks_removed":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          track_count: event.trackCount,
          source_mix: event.sourceMix,
        },
      };
    case "import_cancel_requested":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          total_count: event.totalCount,
          completed_count: event.completedCount,
          active_count: event.activeCount,
          pending_count: event.pendingCount,
        },
      };
    case "import_retry_started":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          provider: event.provider,
          retry_count: event.retryCount,
          previous_failed_count: event.previousFailedCount,
          previous_canceled_count: event.previousCanceledCount,
        },
      };
    case "import_retry_finished":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          provider: event.provider,
          retry_count: event.retryCount,
          completed_count: event.completedCount,
          failed_count: event.failedCount,
          canceled_count: event.canceledCount,
          outcome: event.outcome,
          duration_ms: event.durationMs,
        },
      };
    case "share_created":
    case "share_added":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          share_id: event.shareId,
          share_kind: event.shareKind,
          track_count: event.trackCount,
        },
      };
    case "share_opened":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          share_id: event.shareId,
          share_kind: event.shareKind,
          track_count: event.trackCount,
          viewer: event.viewer,
        },
      };
  }
};

export const createAnalytics = (
  config: AnalyticsConfig,
  dependencies: AnalyticsDependencies,
): Analytics => {
  const enabled = Boolean(config.key) && config.deployEnv === "production";
  const queue: AnalyticsEvent[] = [];
  let client: AnalyticsClient | undefined;
  let loadScheduled = false;

  const captureSafely = (event: AnalyticsEvent) => {
    if (!client) return;
    const serialized = serializeEvent(event, config);
    try {
      client.capture(serialized.name, serialized.properties);
    } catch {
      // Analytics must never interrupt the product workflow that emitted it.
    }
  };

  const flush = () => {
    if (!client) return;
    for (const event of queue.splice(0)) {
      captureSafely(event);
    }
  };

  const scheduleLoad = () => {
    if (!enabled || loadScheduled) return;
    loadScheduled = true;
    dependencies.schedule(() => {
      void dependencies
        .loadClient()
        .then((loadedClient) => {
          loadedClient.init(config.key!, {
            api_host: config.host,
            ui_host: "https://us.posthog.com",
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
            before_send: redactAndValidateEvent,
          });
          client = loadedClient;
          flush();
        })
        .catch(() => {
          loadScheduled = false;
        });
    });
  };

  return {
    initialize: scheduleLoad,
    capture: (event) => {
      if (!enabled) return;
      queue.push(event);
      if (queue.length > MAX_QUEUED_EVENTS) queue.shift();
      flush();
      scheduleLoad();
    },
  };
};

const scheduleWhenIdle = (load: () => void) => {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(load, { timeout: 1_500 });
    return;
  }
  setTimeout(load, 0);
};

const loadPostHogClient = async (): Promise<AnalyticsClient> => {
  const { default: posthog } = await import("posthog-js");
  return {
    init: (key, options) => {
      posthog.init(key, options);
    },
    capture: (event, properties) => {
      posthog.capture(event, properties);
    },
  };
};

export const analytics = createAnalytics(
  {
    key: import.meta.env.VITE_PUBLIC_POSTHOG_KEY,
    host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
    deployEnv: import.meta.env.VITE_PUBLIC_DEPLOY_ENV,
    releaseSha: import.meta.env.VITE_PUBLIC_RELEASE_SHA,
  },
  {
    loadClient: loadPostHogClient,
    schedule: scheduleWhenIdle,
  },
);

export const initializeAnalytics = analytics.initialize;
import {
  METADATA_LINK_DESCRIPTORS,
  serializeMetadataLinkAnalytics,
  type MetadataLinkState,
} from "@/features/library/metadataLinks";
import { isShareAnalyticsId } from "@/features/share/shareManifest";
