import { toast } from "sonner";

export type SystemFailureContext =
  | "download"
  | "import"
  | "upload"
  | "export"
  | "cover-art"
  | "cover-import"
  | "metadata"
  | "storage";

export const systemFailureCodes = [
  "capacity",
  "rate_limited",
  "timeout",
  "service_unavailable",
  "unsupported_source",
  "drm_protected",
  "paid_preview",
  "region_locked",
  "too_long",
  "live_stream",
  "age_restricted",
  "private_or_missing",
  "video_unavailable",
  "provider_blocked",
  "link_expired",
  "parse_failed",
  "processing_failed",
  "browser_unsupported",
  "invalid_response",
  "unknown",
] as const;

export type SystemFailureCode = (typeof systemFailureCodes)[number];

export type SystemFailurePresentation = {
  code: SystemFailureCode;
  title: string;
  description: string;
  trackDescription: string;
  retryable: boolean;
  dedupeKey: string;
};

export type TrackFailureDisplay = Pick<
  SystemFailurePresentation,
  "title" | "description" | "retryable"
>;

const DOWNLOAD_DEBOUNCE_MS = 15_000;

const lastDownloadNotificationAt = new Map<string, number>();

const KNOWN_FAILURES = {
  capacity: {
    code: "capacity",
    title: "downloads are busy",
    description: "too many downloads are running right now. try again in a moment.",
    trackDescription: "downloads are busy. try again in a moment.",
    retryable: true,
    dedupeKey: "system-download-capacity",
  },
  rate_limited: {
    code: "rate_limited",
    title: "too many download requests",
    description: "wait a moment, then try the download again.",
    trackDescription: "too many download requests. try again shortly.",
    retryable: true,
    dedupeKey: "system-download-rate-limited",
  },
  timeout: {
    code: "timeout",
    title: "the download took too long",
    description: "try again. if it keeps failing, try another link.",
    trackDescription: "download timed out. try again.",
    retryable: true,
    dedupeKey: "system-download-timeout",
  },
  service_unavailable: {
    code: "service_unavailable",
    title: "downloads are temporarily unavailable",
    description: "tagium could not reach the download service. try again soon.",
    trackDescription: "downloads are temporarily unavailable.",
    retryable: true,
    dedupeKey: "system-download-service-unavailable",
  },
  unsupported_source: {
    code: "unsupported_source",
    title: "this link is not supported",
    description: "paste a public soundcloud or youtube track, set, or playlist link.",
    trackDescription: "this link is not supported.",
    retryable: false,
    dedupeKey: "system-download-unsupported-source",
  },
  drm_protected: {
    code: "drm_protected",
    title: "this media is drm-protected",
    description: "tagium can't download drm-protected media. try another link.",
    trackDescription: "this media is drm-protected and can't be downloaded.",
    retryable: false,
    dedupeKey: "system-download-drm-protected",
  },
  paid_preview: {
    code: "paid_preview",
    title: "this track is a go+ preview",
    description: "soundcloud only streams a preview of this track, so tagium can't save it.",
    trackDescription: "only a go+ preview is available.",
    retryable: false,
    dedupeKey: "system-download-paid-preview",
  },
  region_locked: {
    code: "region_locked",
    title: "this media is region-locked",
    description: "the provider blocks it where our servers are. try another link.",
    trackDescription: "region-locked.",
    retryable: false,
    dedupeKey: "system-download-region-locked",
  },
  too_long: {
    code: "too_long",
    title: "this media is too long",
    description: "tagium can save media up to 3 hours long.",
    trackDescription: "longer than 3 hours.",
    retryable: false,
    dedupeKey: "system-download-too-long",
  },
  live_stream: {
    code: "live_stream",
    title: "live streams can't be saved",
    description: "wait until the stream ends, then try again.",
    trackDescription: "live streams can't be saved.",
    retryable: false,
    dedupeKey: "system-download-live-stream",
  },
  age_restricted: {
    code: "age_restricted",
    title: "this media is age-restricted",
    description: "tagium can't sign in to download age-restricted media.",
    trackDescription: "age-restricted.",
    retryable: false,
    dedupeKey: "system-download-age-restricted",
  },
  private_or_missing: {
    code: "private_or_missing",
    title: "we could not access this media",
    description: "check that the link is public and still available.",
    trackDescription: "media is private, unavailable, or no longer exists.",
    retryable: false,
    dedupeKey: "system-download-private-or-missing",
  },
  video_unavailable: {
    code: "video_unavailable",
    title: "this video is unavailable",
    description: "it may be private, removed, or temporarily blocked by youtube.",
    trackDescription: "unavailable or blocked by youtube.",
    retryable: false,
    dedupeKey: "system-download-video-unavailable",
  },
  provider_blocked: {
    code: "provider_blocked",
    title: "youtube is blocking downloads right now",
    description: "this isn't a problem with your link. try again later.",
    trackDescription: "youtube is blocking downloads. try again later.",
    retryable: true,
    dedupeKey: "system-download-provider-blocked",
  },
  link_expired: {
    code: "link_expired",
    title: "the download link expired",
    description: "try again to get a fresh link.",
    trackDescription: "download link expired. try again.",
    retryable: true,
    dedupeKey: "system-download-link-expired",
  },
  parse_failed: {
    code: "parse_failed",
    title: "tagium couldn't read the downloaded audio",
    description: "switch the audio format in settings, then try again.",
    trackDescription: "tagium couldn't read the downloaded audio.",
    retryable: false,
    dedupeKey: "system-download-parse-failed",
  },
  processing_failed: {
    code: "processing_failed",
    title: "tagium couldn't convert this audio",
    description: "switch the audio format in settings or try another browser.",
    trackDescription: "tagium couldn't convert this audio.",
    retryable: true,
    dedupeKey: "system-download-processing-failed",
  },
  browser_unsupported: {
    code: "browser_unsupported",
    title: "this browser can't process video",
    description: "try a recent chrome, edge, or firefox.",
    trackDescription: "this browser can't process video. try a recent chrome, edge, or firefox.",
    retryable: false,
    dedupeKey: "system-download-browser-unsupported",
  },
  invalid_response: {
    code: "invalid_response",
    title: "we could not read this media",
    description: "the provider returned an unexpected response. try again or use another link.",
    trackDescription: "the media provider returned an unexpected response.",
    retryable: true,
    dedupeKey: "system-download-invalid-response",
  },
} as const satisfies Record<Exclude<SystemFailureCode, "unknown">, SystemFailurePresentation>;

const FALLBACKS = {
  download: {
    title: "download failed",
    description: "tagium could not download this track. try again or use another link.",
    trackDescription: "download failed. try again or use another link.",
  },
  import: {
    title: "import failed",
    description: "tagium could not import this media. try again in a moment.",
    trackDescription: "import failed. try again.",
  },
  upload: {
    title: "some files could not be imported",
    description:
      "tagium could not read one or more audio files. try a valid mp3, flac, m4a, or opus file.",
    trackDescription: "one or more audio files could not be read.",
  },
  export: {
    title: "export failed",
    description: "tagium could not prepare your download. your tracks are still in the library.",
    trackDescription: "export failed. your tracks are still in the library.",
  },
  "cover-art": {
    title: "cover art failed",
    description: "tagium could not process this cover image. try another jpeg or png.",
    trackDescription: "cover art could not be processed.",
  },
  "cover-import": {
    title: "cover art was not imported",
    description: "the tracks were imported without cover art. upload a jpeg or png manually.",
    trackDescription: "cover art was not imported. upload an image manually.",
  },
  metadata: {
    title: "metadata could not be saved",
    description: "your edits are still visible. try the action again.",
    trackDescription: "metadata could not be saved. try again.",
  },
  storage: {
    title: "settings could not be saved",
    description: "your browser did not allow tagium to store these settings.",
    trackDescription: "settings could not be saved.",
  },
} as const satisfies Record<
  SystemFailureContext,
  Pick<SystemFailurePresentation, "title" | "description" | "trackDescription">
>;

const errorMessage = (cause: unknown) => {
  if (cause instanceof Error) return cause.message;

  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }

  return "";
};

const COBALT_UNSUPPORTED_CODES = [
  "error.api.link.invalid",
  "error.api.link.unsupported",
  "error.api.service.unsupported",
  "error.api.service.audio_not_supported",
] as const;

const COBALT_DRM_CODES = ["error.api.soundcloud.maybe_drm", "error.api.youtube.drm"] as const;

const COBALT_REGION_CODES = ["error.api.content.region", "error.api.content.video.region"] as const;

const COBALT_AGE_CODES = ["error.api.content.post.age", "error.api.content.video.age"] as const;

const YOUTUBE_BLOCKING_CODES = [
  "error.api.youtube.login",
  "error.api.youtube.no_session_tokens",
  "error.api.youtube.token_expired",
  "error.api.youtube.decipher",
  "error.api.youtube.api_error",
  "error.api.fetch.rate",
] as const;

const COBALT_PRIVATE_OR_MISSING_CODES = [
  "error.api.content.post.private",
  "error.api.content.post.unavailable",
  "error.api.content.video.private",
] as const;

const includesAny = (message: string, codes: readonly string[]) =>
  codes.some((code) => message.includes(code));

const knownDownloadFailureFrom = (message: string): SystemFailurePresentation | null => {
  const lower = message.toLowerCase();

  if (lower.includes("error.api.capacity_exceeded")) return KNOWN_FAILURES.capacity;

  if (includesAny(lower, YOUTUBE_BLOCKING_CODES)) return KNOWN_FAILURES.provider_blocked;

  if (
    lower.includes("error.api.rate_exceeded") ||
    lower.includes("rate limit") ||
    lower.includes("rate-limit") ||
    lower.includes("too many downloads") ||
    /\b429\b/.test(lower)
  ) {
    return KNOWN_FAILURES.rate_limited;
  }

  if (lower.includes("error.api.timed_out") || /\btimed?\s*out\b/.test(lower)) {
    return KNOWN_FAILURES.timeout;
  }

  if (
    lower.includes("error.api.unreachable") ||
    lower.includes("cobalt_api_url is not configured") ||
    lower.includes("download admission is unavailable") ||
    lower.includes("networkerror") ||
    lower.includes("failed to fetch") ||
    /\bload failed\b/.test(lower)
  ) {
    return KNOWN_FAILURES.service_unavailable;
  }

  if (includesAny(lower, COBALT_DRM_CODES)) return KNOWN_FAILURES.drm_protected;

  if (lower.includes("error.api.content.paid")) return KNOWN_FAILURES.paid_preview;

  if (includesAny(lower, COBALT_REGION_CODES)) return KNOWN_FAILURES.region_locked;

  if (lower.includes("error.api.content.too_long")) return KNOWN_FAILURES.too_long;

  if (lower.includes("error.api.content.video.live")) return KNOWN_FAILURES.live_stream;

  if (includesAny(lower, COBALT_AGE_CODES)) return KNOWN_FAILURES.age_restricted;

  if (
    includesAny(lower, COBALT_UNSUPPORTED_CODES) ||
    lower.includes("unsupported url") ||
    lower.includes("not supported")
  ) {
    return KNOWN_FAILURES.unsupported_source;
  }

  if (lower.includes("error.api.content.video.unavailable")) {
    return KNOWN_FAILURES.video_unavailable;
  }

  if (
    includesAny(lower, COBALT_PRIVATE_OR_MISSING_CODES) ||
    /\b(?:soundcloud set|youtube playlist) request failed \(40[134]\)/.test(lower)
  ) {
    return KNOWN_FAILURES.private_or_missing;
  }

  if (
    /\btunnel request failed \(40[134]\)/.test(lower) ||
    /\bsoundcloud stream part request failed \(40[34]\)/.test(lower)
  ) {
    return KNOWN_FAILURES.link_expired;
  }

  if (lower.includes("local video processing is unavailable")) {
    return KNOWN_FAILURES.browser_unsupported;
  }

  if (lower.includes("downloaded track could not be parsed")) return KNOWN_FAILURES.parse_failed;

  if (lower.includes("local audio processing")) return KNOWN_FAILURES.processing_failed;

  if (
    lower.includes("error.api.fetch.empty") ||
    lower.includes("error.api.invalid_response") ||
    lower.includes("malformed") ||
    lower.includes("invalid response") ||
    lower.includes("invalid machine id") ||
    lower.includes("invalid download plan") ||
    lower.includes("non-json") ||
    lower.includes("response was empty") ||
    lower.includes("missing audio")
  ) {
    return KNOWN_FAILURES.invalid_response;
  }

  return null;
};

export const getSystemFailurePresentation = (
  cause: unknown,
  context: SystemFailureContext,
): SystemFailurePresentation => {
  const known =
    context === "download" || context === "import"
      ? knownDownloadFailureFrom(errorMessage(cause))
      : null;

  if (known) return known;

  const fallback = FALLBACKS[context];

  return {
    code: "unknown",
    ...fallback,
    retryable: true,
    dedupeKey: `system-${context}-unknown`,
  };
};

export const reportSystemFailure = (
  cause: unknown,
  context: SystemFailureContext,
): SystemFailurePresentation => {
  const presentation = getSystemFailurePresentation(cause, context);

  if (context === "download") {
    const now = Date.now();
    const lastNotifiedAt = lastDownloadNotificationAt.get(presentation.dedupeKey);

    if (lastNotifiedAt !== undefined && now - lastNotifiedAt < DOWNLOAD_DEBOUNCE_MS) {
      return presentation;
    }

    lastDownloadNotificationAt.set(presentation.dedupeKey, now);
    toast.error(presentation.title, {
      id: presentation.dedupeKey,
      description: presentation.description,
    });

    return presentation;
  }

  toast.error(presentation.title, { description: presentation.description });

  return presentation;
};

export const getTrackFailureDisplay = (message: string): TrackFailureDisplay => {
  const storedPresentation = Object.values(KNOWN_FAILURES).find(
    (presentation) => presentation.trackDescription === message,
  );

  if (storedPresentation) {
    return {
      title: storedPresentation.title,
      description: storedPresentation.trackDescription,
      retryable: storedPresentation.retryable,
    };
  }

  const storedFallback = Object.values(FALLBACKS).find(
    (presentation) => presentation.trackDescription === message,
  );

  if (storedFallback) {
    return {
      title: storedFallback.title,
      description: storedFallback.trackDescription,
      retryable: true,
    };
  }

  const known = knownDownloadFailureFrom(message);

  if (known) {
    return { title: known.title, description: known.trackDescription, retryable: known.retryable };
  }

  return {
    title: "track error",
    description: "this track needs attention before it can be exported.",
    retryable: true,
  };
};

export const resetSystemFailureReportingForTest = () => {
  lastDownloadNotificationAt.clear();
};
