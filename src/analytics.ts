import { Schema } from "effect";
import type { CaptureResult, PostHogConfig } from "posthog-js";
import type { MediaLinkKind } from "@/lib/media-link";

export type { MediaLinkKind } from "@/lib/media-link";

export type AudioUploadTargetKind = "loose" | "album";
export type ImportKind = "single" | "set";
export type ImportOutcome = "completed" | "partial" | "failed" | "canceled";
export type ExportKind = "track" | "album" | "library";
export type TrackSourceMix = "local" | "imported" | "mixed" | "unknown";
export type AnalyticsProvider = "youtube" | "soundcloud" | "other";
export type AnalyticsProviderScope = AnalyticsProvider | "mixed";
export type AnalyticsAppId = "tagium" | "tagium-save";
export type AnalyticsRequestedFormat = "best" | "mp3" | "opus";
export type AnalyticsOutputFormat =
  | "mp3"
  | "m4a"
  | "flac"
  | "ogg"
  | "wav"
  | "opus"
  | "mp4"
  | "webm"
  | "mkv"
  | "gif"
  | "jpg"
  | "jpeg"
  | "png"
  | "webp"
  | "zip"
  | "other";
export type DownloadMode = "auto" | "audio" | "mute";
export type DownloadVideoQuality = "1080" | "720" | "480";
export type DownloadVideoContainer = "mp4" | "webm" | "mkv";
export type DownloadVideoCodec = "h264" | "av1" | "vp9";
export type DownloadResultKind = "file" | "picker";
export type DownloadFailureStage = "planning" | "tunnel" | "processing" | "finalizing";
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
  | "unsupported_source"
  | "private_or_missing"
  | "invalid_response"
  | "unknown";

const MEDIA_LINK_KIND_PROPERTY = "shape";

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
      mediaKind: "media" | "track" | "playlist" | "unsupported";
      linkKind: MediaLinkKind;
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
      requestedFormat?: AnalyticsRequestedFormat;
    }
  | {
      type: "import_resolved";
      sourceUrl: string;
      importKind: ImportKind;
      resolvedCount: number;
      hasCover: boolean;
      requestedFormat?: AnalyticsRequestedFormat;
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
      requestedFormat?: AnalyticsRequestedFormat;
    }
  | {
      type: "import_resolution_failed";
      sourceUrl: string;
      importKind: ImportKind;
      code: ImportFailureCode;
      requestedFormat?: AnalyticsRequestedFormat;
    }
  | {
      type: "import_failure_category";
      sourceUrl: string;
      importKind: ImportKind;
      stage: ImportFailureStage;
      code: ImportFailureCode;
      trackCount: number;
      requestedFormat?: AnalyticsRequestedFormat;
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
      sourceUrl?: string;
      outputFormat?: AnalyticsOutputFormat;
    }
  | {
      type: "export_failed";
      exportKind: ExportKind;
      error: Error;
    }
  | {
      type: "settings_changed";
      syncFilenames: boolean;
      audioBitrate: "320" | "256" | "128" | "96" | "64";
      audioFormat: "best" | "mp3";
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
      type: "share_created" | "share_updated";
      shareId: string;
      shareKind: "album" | "track";
      trackCount: number;
      contentTitle: string;
    }
  | {
      type: "share_added";
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
    }
  | {
      type: "download_started";
      sourceUrl: string;
      requestedMode: DownloadMode;
      requestedVideoQuality: DownloadVideoQuality;
      requestedContainer: DownloadVideoContainer;
      requestedCodec: DownloadVideoCodec;
      requestedAudioFormat: AnalyticsRequestedFormat;
      isRetry: boolean;
    }
  | {
      type: "download_resolved";
      sourceUrl: string;
      resultKind: DownloadResultKind;
      resourceCount: number;
    }
  | {
      type: "download_finished";
      sourceUrl: string;
      outcome: "completed";
      durationMs: number;
      outputFormat: AnalyticsOutputFormat;
      sizeBytes: number;
    }
  | {
      type: "download_finished";
      sourceUrl: string;
      outcome: "failed";
      durationMs: number;
      failureStage: DownloadFailureStage;
      failureCode: AnalyticsErrorCode;
    }
  | {
      type: "download_finished";
      sourceUrl: string;
      outcome: "canceled";
      durationMs: number;
    };

export interface AnalyticsConfig {
  key?: string;
  host?: string;
  deployEnv?: string;
  releaseSha?: string;
}

interface AnalyticsClient {
  init: (key: string, options: Partial<PostHogConfig>) => void;
  capture: (event: string, properties?: AnalyticsProperties) => void;
}

interface AnalyticsDependencies {
  loadClient: () => Promise<AnalyticsClient>;
  schedule: (load: () => void) => void;
}

const MAX_QUEUED_EVENTS = 100;

export interface Analytics {
  initialize: (appId: AnalyticsAppId) => void;
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

const errorCodeFrom = (error: Error): AnalyticsErrorCode => {
  const message = error.message;
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

type AnalyticsProperty = string | number | boolean | Date | null | undefined;
interface AnalyticsProperties {
  [key: string]: AnalyticsProperty;
}

const COMMON_CUSTOM_PROPERTIES = ["event_version", "deploy_env", "release_sha", "app_id"];
const CUSTOM_EVENT_PROPERTIES = {
  media_link_processed: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "media_kind",
    MEDIA_LINK_KIND_PROPERTY,
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
  import_started: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "import_kind",
    "requested_format",
  ]),
  import_resolved: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "import_kind",
    "resolved_count",
    "has_cover",
    "requested_format",
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
    "requested_format",
  ]),
  import_failure_category: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "import_kind",
    "stage",
    "code",
    "track_count",
    "requested_format",
  ]),
  import_resolution_failed: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "import_kind",
    "code",
    "requested_format",
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
    "provider",
    "output_format",
  ]),
  export_failed: new Set([...COMMON_CUSTOM_PROPERTIES, "export_kind", "error_code"]),
  settings_changed: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "sync_track_numbers",
    "sync_filenames",
    "audio_bitrate",
    "audio_format",
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
  share_created: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "share_id",
    "share_kind",
    "track_count",
    "content_title",
  ]),
  share_updated: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "share_id",
    "share_kind",
    "track_count",
    "content_title",
  ]),
  share_opened: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "share_id",
    "share_kind",
    "track_count",
    "viewer",
  ]),
  share_added: new Set([...COMMON_CUSTOM_PROPERTIES, "share_id", "share_kind", "track_count"]),
  download_started: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "requested_mode",
    "requested_video_quality",
    "requested_container",
    "requested_codec",
    "requested_audio_format",
    "is_retry",
  ]),
  download_resolved: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "result_kind",
    "resource_count",
  ]),
  download_finished: new Set([
    ...COMMON_CUSTOM_PROPERTIES,
    "provider",
    "outcome",
    "duration_ms",
    "output_format",
    "size_bucket",
    "failure_stage",
    "failure_code",
  ]),
} satisfies Partial<Record<AnalyticsEvent["type"], ReadonlySet<string>>>;
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
  "$cookieless_mode",
  "$lib",
  "$lib_version",
  "$raw_user_agent",
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
const isString = Schema.is(Schema.String);
const isNumber = Schema.is(Schema.Number);
const isBoolean = Schema.is(Schema.Boolean);
type AnalyticsPropertyValidator = (value: AnalyticsProperty) => boolean;
const isOneOf =
  <Value extends string>(values: readonly Value[]) =>
  (value: AnalyticsProperty): value is Value =>
    isString(value) && values.some((candidate) => candidate === value);
const isBoundedTunnelAttempt = (value: AnalyticsProperty) =>
  isNumber(value) && Number.isInteger(value) && value >= 1 && value <= 7;
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
  "unsupported_source",
  "private_or_missing",
  "invalid_response",
  "unknown",
] as const);
const isNonNegativeInteger = (value: AnalyticsProperty) =>
  isNumber(value) && Number.isInteger(value) && value >= 0;
const isPositiveInteger = (value: AnalyticsProperty) =>
  isNumber(value) && Number.isInteger(value) && value > 0;
const isNonNegativeNumber = (value: AnalyticsProperty) =>
  isNumber(value) && Number.isFinite(value) && value >= 0;
const isMediaKind = isOneOf(["media", "track", "playlist", "unsupported"] as const);
const isMediaLinkKind = isOneOf(["canonical", "short", "mobile", "nocookie", "other"] as const);
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
const isRequestedFormat = isOneOf(["best", "mp3", "opus"] as const);
const isOutputFormat = isOneOf([
  "mp3",
  "m4a",
  "flac",
  "ogg",
  "wav",
  "opus",
  "mp4",
  "webm",
  "mkv",
  "gif",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "zip",
  "other",
] as const);
const isDownloadMode = isOneOf(["auto", "audio", "mute"] as const);
const isDownloadVideoQuality = isOneOf(["1080", "720", "480"] as const);
const isDownloadVideoContainer = isOneOf(["mp4", "webm", "mkv"] as const);
const isDownloadVideoCodec = isOneOf(["h264", "av1", "vp9"] as const);
const isDownloadResultKind = isOneOf(["file", "picker"] as const);
const isDownloadOutcome = isOneOf(["completed", "failed", "canceled"] as const);
const isDownloadFailureStage = isOneOf(["planning", "tunnel", "processing", "finalizing"] as const);
const isExportKind = isOneOf(["track", "album", "library"] as const);
const isAnalyticsErrorCode = isOneOf([
  "capacity",
  "rate_limited",
  "service_unavailable",
  "timeout",
  "parse_failed",
  "metadata_write_failed",
  "unsupported_source",
  "private_or_missing",
  "invalid_response",
  "unknown",
] as const);
const isSizeBucket = isOneOf([
  "under_10_mb",
  "10_to_100_mb",
  "100_to_500_mb",
  "500_mb_or_more",
] as const);
const MAX_CONTENT_TITLE_LENGTH = 200;
const isSafeContentTitleCharacter = (character: string) => {
  const code = character.charCodeAt(0);
  return code > 31 && code !== 127;
};
const isContentTitle = (value: AnalyticsProperty) =>
  isString(value) &&
  value.trim().length > 0 &&
  Array.from(value).length <= MAX_CONTENT_TITLE_LENGTH &&
  Array.from(value).every(isSafeContentTitleCharacter);

const CUSTOM_PROPERTY_VALIDATORS = {
  media_link_processed: {
    provider: isAnalyticsProvider,
    media_kind: isMediaKind,
    [MEDIA_LINK_KIND_PROPERTY]: isMediaLinkKind,
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
  import_started: {
    provider: isAnalyticsProvider,
    import_kind: isImportKind,
    requested_format: isRequestedFormat,
  },
  import_resolved: {
    provider: isAnalyticsProvider,
    import_kind: isImportKind,
    resolved_count: isPositiveInteger,
    requested_format: isRequestedFormat,
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
    requested_format: isRequestedFormat,
  },
  import_failure_category: {
    provider: isAnalyticsProvider,
    import_kind: isImportKind,
    stage: isImportFailureStage,
    code: isImportFailureCode,
    track_count: isPositiveInteger,
    requested_format: isRequestedFormat,
  },
  import_resolution_failed: {
    provider: isAnalyticsProvider,
    import_kind: isImportKind,
    code: isImportFailureCode,
    requested_format: isRequestedFormat,
  },
  export_prepared: {
    export_kind: isExportKind,
    track_count: isPositiveInteger,
    album_count: isNonNegativeInteger,
    size_bucket: isSizeBucket,
    provider: isAnalyticsProvider,
    output_format: isOutputFormat,
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
    content_title: isContentTitle,
  },
  share_updated: {
    share_id: isShareAnalyticsId,
    share_kind: isShareKind,
    track_count: isPositiveInteger,
    content_title: isContentTitle,
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
  download_started: {
    provider: isAnalyticsProvider,
    requested_mode: isDownloadMode,
    requested_video_quality: isDownloadVideoQuality,
    requested_container: isDownloadVideoContainer,
    requested_codec: isDownloadVideoCodec,
    requested_audio_format: isRequestedFormat,
    is_retry: isBoolean,
  },
  download_resolved: {
    provider: isAnalyticsProvider,
    result_kind: isDownloadResultKind,
    resource_count: isPositiveInteger,
  },
  download_finished: {
    provider: isAnalyticsProvider,
    outcome: isDownloadOutcome,
    duration_ms: isNonNegativeNumber,
    output_format: isOutputFormat,
    size_bucket: isSizeBucket,
    failure_stage: isDownloadFailureStage,
    failure_code: isAnalyticsErrorCode,
  },
} satisfies Partial<
  Record<AnalyticsEvent["type"], Readonly<Record<string, AnalyticsPropertyValidator>>>
>;

const redactAndValidateEvent = (
  event: CaptureResult,
  appId: AnalyticsAppId,
): CaptureResult | null => {
  const customAllowedProperties = Object.entries(CUSTOM_EVENT_PROPERTIES).find(
    ([eventName]) => eventName === event.event,
  )?.[1];
  const customPropertyValidators = Object.entries(CUSTOM_PROPERTY_VALIDATORS).find(
    ([eventName]) => eventName === event.event,
  )?.[1];
  const isSdkEvent = SAFE_SDK_EVENTS.has(event.event);
  if (!customAllowedProperties && !isSdkEvent) return null;

  const properties: AnalyticsProperties = {};
  for (const [property, value] of Object.entries(event.properties ?? {})) {
    const isAllowedCustomProperty = customAllowedProperties?.has(property) ?? false;
    const isAllowedSdkProperty = SAFE_SDK_PROPERTIES.has(property);
    const isRawUserAgent = property === "$raw_user_agent";
    if (!isAllowedCustomProperty && !isAllowedSdkProperty) continue;
    if (isRawUserAgent && (!isString(value) || value.length > 1_000)) continue;
    if (property === "$cookieless_mode" && value !== true) continue;
    const customValidator = Object.entries(customPropertyValidators ?? {}).find(
      ([propertyName]) => propertyName === property,
    )?.[1];
    if (customValidator && !customValidator(value)) continue;
    if (!isAllowedCustomProperty && SENSITIVE_PROPERTY_NAME.test(property)) continue;
    if (!isAllowedCustomProperty && !isRawUserAgent && isString(value) && URL_VALUE.test(value))
      continue;
    properties[property] = value;
  }

  if (event.event === "import_retry_finished" || event.event === "import_finished") {
    const expectedCount =
      event.event === "import_retry_finished" ? properties.retry_count : properties.total_count;
    const completedCount = properties.completed_count;
    const failedCount = properties.failed_count;
    const canceledCount = properties.canceled_count;
    if (
      !isNumber(expectedCount) ||
      !isNumber(completedCount) ||
      !isNumber(failedCount) ||
      !isNumber(canceledCount) ||
      completedCount + failedCount + canceledCount !== expectedCount
    ) {
      return null;
    }
  }

  if (
    (event.event === "share_created" || event.event === "share_updated") &&
    !isContentTitle(properties.content_title)
  ) {
    return null;
  }

  if (event.event === "download_finished") {
    const outcome = properties.outcome;
    const hasOutput =
      isOutputFormat(properties.output_format) && isSizeBucket(properties.size_bucket);
    const hasFailure =
      isDownloadFailureStage(properties.failure_stage) &&
      isAnalyticsErrorCode(properties.failure_code);
    if (
      !isNonNegativeNumber(properties.duration_ms) ||
      !isAnalyticsProvider(properties.provider) ||
      (outcome === "completed" && (!hasOutput || hasFailure)) ||
      (outcome === "failed" && (!hasFailure || hasOutput)) ||
      (outcome === "canceled" && (hasOutput || hasFailure)) ||
      (outcome !== "completed" && outcome !== "failed" && outcome !== "canceled")
    ) {
      return null;
    }
  }

  properties.app_id = appId;
  const normalizedEvent: CaptureResult = {
    uuid: event.uuid,
    event: event.event,
    properties,
  };
  if (event.timestamp !== undefined) normalizedEvent.timestamp = event.timestamp;
  return normalizedEvent;
};

const sizeBucket = (sizeBytes: number) => {
  const sizeMb = sizeBytes / (1024 * 1024);
  if (sizeMb < 10) return "under_10_mb";
  if (sizeMb < 100) return "10_to_100_mb";
  if (sizeMb < 500) return "100_to_500_mb";
  return "500_mb_or_more";
};

const normalizeContentTitle = (title: string) => {
  const normalized = Array.from(title, (character) =>
    isSafeContentTitleCharacter(character) ? character : " ",
  )
    .join("")
    .trim();
  return normalized
    ? Array.from(normalized).slice(0, MAX_CONTENT_TITLE_LENGTH).join("")
    : undefined;
};

export const analyticsOutputFormatFromFilename = (filename: string): AnalyticsOutputFormat => {
  const extensionStart = filename.lastIndexOf(".");
  if (extensionStart <= 0 || extensionStart === filename.length - 1) return "other";
  const extension = filename.slice(extensionStart + 1).toLowerCase();
  return isOutputFormat(extension) ? extension : "other";
};

const serializeEvent = (event: AnalyticsEvent, config: AnalyticsConfig, appId: AnalyticsAppId) => {
  const commonProperties: AnalyticsProperties = {
    event_version: 1,
    deploy_env: config.deployEnv,
    app_id: appId,
  };
  if (config.releaseSha) commonProperties.release_sha = config.releaseSha;

  switch (event.type) {
    case "media_link_processed": {
      const properties: AnalyticsProperties = {
        ...commonProperties,
        provider: analyticsProviderFromUrl(event.sourceUrl),
        media_kind: event.mediaKind,
        [MEDIA_LINK_KIND_PROPERTY]: event.linkKind,
        normalized: event.normalized,
        redirected: event.redirected,
        outcome: event.outcome,
      };
      if (event.failureReason) properties.failure_reason = event.failureReason;
      return {
        name: event.type,
        properties,
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
    case "import_started": {
      const properties: AnalyticsProperties = {
        ...commonProperties,
        provider: analyticsProviderFromUrl(event.sourceUrl),
        import_kind: event.importKind,
      };
      if (event.requestedFormat) properties.requested_format = event.requestedFormat;
      return {
        name: event.type,
        properties,
      };
    }
    case "import_resolved": {
      const properties: AnalyticsProperties = {
        ...commonProperties,
        provider: analyticsProviderFromUrl(event.sourceUrl),
        import_kind: event.importKind,
        resolved_count: event.resolvedCount,
        has_cover: event.hasCover,
      };
      if (event.requestedFormat) properties.requested_format = event.requestedFormat;
      return {
        name: event.type,
        properties,
      };
    }
    case "import_finished": {
      const properties: AnalyticsProperties = {
        ...commonProperties,
        provider: analyticsProviderFromUrl(event.sourceUrl),
        import_kind: event.importKind,
        outcome: event.outcome,
        total_count: event.totalCount,
        completed_count: event.completedCount,
        failed_count: event.failedCount,
        canceled_count: event.canceledCount,
        duration_ms: event.durationMs,
      };
      if (event.requestedFormat) properties.requested_format = event.requestedFormat;
      return {
        name: event.type,
        properties,
      };
    }
    case "import_failure_category": {
      const properties: AnalyticsProperties = {
        ...commonProperties,
        provider: analyticsProviderFromUrl(event.sourceUrl),
        import_kind: event.importKind,
        stage: event.stage,
        code: event.code,
        track_count: event.trackCount,
      };
      if (event.requestedFormat) properties.requested_format = event.requestedFormat;
      return {
        name: event.type,
        properties,
      };
    }
    case "import_resolution_failed": {
      const properties: AnalyticsProperties = {
        ...commonProperties,
        provider: analyticsProviderFromUrl(event.sourceUrl),
        import_kind: event.importKind,
        code: event.code,
      };
      if (event.requestedFormat) properties.requested_format = event.requestedFormat;
      return {
        name: event.type,
        properties,
      };
    }
    case "export_started": {
      const properties: AnalyticsProperties = {
        ...commonProperties,
        export_kind: event.exportKind,
        track_count: event.trackCount,
      };
      if (event.albumCount !== undefined) properties.album_count = event.albumCount;
      return {
        name: event.type,
        properties,
      };
    }
    case "export_prepared": {
      const properties: AnalyticsProperties = {
        ...commonProperties,
        export_kind: event.exportKind,
        track_count: event.trackCount,
        size_bucket: sizeBucket(event.sizeBytes),
      };
      if (event.albumCount !== undefined) properties.album_count = event.albumCount;
      if (event.sourceUrl !== undefined) {
        properties.provider = analyticsProviderFromUrl(event.sourceUrl);
      }
      if (event.outputFormat !== undefined) properties.output_format = event.outputFormat;
      return {
        name: event.type,
        properties,
      };
    }
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
          audio_format: event.audioFormat,
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
    case "share_updated": {
      const properties: AnalyticsProperties = {
        ...commonProperties,
        share_id: event.shareId,
        share_kind: event.shareKind,
        track_count: event.trackCount,
      };
      const contentTitle = normalizeContentTitle(event.contentTitle);
      if (contentTitle) properties.content_title = contentTitle;
      return {
        name: event.type,
        properties,
      };
    }
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
    case "download_started":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          provider: analyticsProviderFromUrl(event.sourceUrl),
          requested_mode: event.requestedMode,
          requested_video_quality: event.requestedVideoQuality,
          requested_container: event.requestedContainer,
          requested_codec: event.requestedCodec,
          requested_audio_format: event.requestedAudioFormat,
          is_retry: event.isRetry,
        },
      };
    case "download_resolved":
      return {
        name: event.type,
        properties: {
          ...commonProperties,
          provider: analyticsProviderFromUrl(event.sourceUrl),
          result_kind: event.resultKind,
          resource_count: event.resourceCount,
        },
      };
    case "download_finished": {
      const properties: AnalyticsProperties = {
        ...commonProperties,
        provider: analyticsProviderFromUrl(event.sourceUrl),
        outcome: event.outcome,
        duration_ms: event.durationMs,
      };
      if (event.outcome === "completed") {
        properties.output_format = event.outputFormat;
        properties.size_bucket = sizeBucket(event.sizeBytes);
      } else if (event.outcome === "failed") {
        properties.failure_stage = event.failureStage;
        properties.failure_code = event.failureCode;
      }
      return { name: event.type, properties };
    }
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
  let appId: AnalyticsAppId | undefined;

  const captureSafely = (event: AnalyticsEvent) => {
    if (!client || !appId) return;
    const serialized = serializeEvent(event, config, appId);
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
    if (!enabled || loadScheduled || !appId) return;
    const initializedAppId = appId;
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
            cookieless_mode: "always",
            person_profiles: "never",
            before_send: (event) =>
              event ? redactAndValidateEvent(event, initializedAppId) : null,
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
    initialize: (initializedAppId) => {
      if (appId && appId !== initializedAppId) return;
      appId = initializedAppId;
      scheduleLoad();
    },
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
