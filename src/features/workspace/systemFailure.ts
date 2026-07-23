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

export type SystemFailureCode =
  | "capacity"
  | "rate_limited"
  | "timeout"
  | "service_unavailable"
  | "unsupported_source"
  | "private_or_missing"
  | "invalid_response"
  | "unknown";

export type SystemFailurePresentation = {
  code: SystemFailureCode;
  title: string;
  description: string;
  trackDescription: string;
  retryable: boolean;
  dedupeKey: string;
};

export type TrackFailureDisplay = Pick<SystemFailurePresentation, "title" | "description">;

const DOWNLOAD_DEBOUNCE_MS = 15_000;
const lastDownloadNotificationAt = new Map<string, number>();

const KNOWN_FAILURES = {
  capacity: {
    code: "capacity",
    title: "downloads are busy",
    description: "Too many downloads are running right now. Try again in a moment.",
    trackDescription: "downloads are busy. try again in a moment.",
    retryable: true,
    dedupeKey: "system-download-capacity",
  },
  rate_limited: {
    code: "rate_limited",
    title: "too many download requests",
    description: "Wait a moment, then try the download again.",
    trackDescription: "too many download requests. try again shortly.",
    retryable: true,
    dedupeKey: "system-download-rate-limited",
  },
  timeout: {
    code: "timeout",
    title: "the download took too long",
    description: "Try again. If it keeps failing, try another link.",
    trackDescription: "download timed out. try again.",
    retryable: true,
    dedupeKey: "system-download-timeout",
  },
  service_unavailable: {
    code: "service_unavailable",
    title: "downloads are temporarily unavailable",
    description: "tagium could not reach the download service. Try again soon.",
    trackDescription: "audio downloads are temporarily unavailable.",
    retryable: true,
    dedupeKey: "system-download-service-unavailable",
  },
  unsupported_source: {
    code: "unsupported_source",
    title: "this link is not supported",
    description: "Try a public SoundCloud or YouTube track URL.",
    trackDescription: "this link is not supported.",
    retryable: false,
    dedupeKey: "system-download-unsupported-source",
  },
  private_or_missing: {
    code: "private_or_missing",
    title: "we could not access this media",
    description: "Check that the link is public and still available, then try again.",
    trackDescription: "media is private, unavailable, or no longer exists.",
    retryable: false,
    dedupeKey: "system-download-private-or-missing",
  },
  invalid_response: {
    code: "invalid_response",
    title: "we could not read this media",
    description: "The provider returned an unexpected response. Try again or use another link.",
    trackDescription: "the media provider returned an unexpected response.",
    retryable: true,
    dedupeKey: "system-download-invalid-response",
  },
} as const satisfies Record<string, SystemFailurePresentation>;

const FALLBACKS = {
  download: {
    title: "download failed",
    description: "tagium could not download this track. Try again or use another link.",
    trackDescription: "download failed. try again or use another link.",
  },
  import: {
    title: "import failed",
    description: "tagium could not import this media. Try again in a moment.",
    trackDescription: "import failed. try again.",
  },
  upload: {
    title: "some files could not be imported",
    description:
      "tagium could not read one or more audio files. Try a valid MP3, FLAC, or M4A file.",
    trackDescription: "one or more audio files could not be read.",
  },
  export: {
    title: "export failed",
    description: "tagium could not prepare your download. Your tracks are still in the library.",
    trackDescription: "export failed. your tracks are still in the library.",
  },
  "cover-art": {
    title: "cover art failed",
    description: "tagium could not process this cover image. Try another jpeg or png.",
    trackDescription: "cover art could not be processed.",
  },
  "cover-import": {
    title: "cover art was not imported",
    description: "The tracks were imported without cover art. Upload a jpeg or png manually.",
    trackDescription: "cover art was not imported. upload an image manually.",
  },
  metadata: {
    title: "metadata could not be saved",
    description: "Your edits are still visible. Try the action again.",
    trackDescription: "metadata could not be saved. try again.",
  },
  storage: {
    title: "settings could not be saved",
    description: "Your browser did not allow tagium to store these settings.",
    trackDescription: "settings could not be saved.",
  },
} as const satisfies Record<
  SystemFailureContext,
  Pick<SystemFailurePresentation, "title" | "description" | "trackDescription">
>;

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

const knownDownloadFailureFrom = (message: string): SystemFailurePresentation | null => {
  const lower = message.toLowerCase();

  if (lower.includes("error.api.capacity_exceeded")) return KNOWN_FAILURES.capacity;
  if (
    lower.includes("error.api.rate_exceeded") ||
    lower.includes("rate limit") ||
    lower.includes("rate-limit") ||
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
    lower.includes("networkerror") ||
    lower.includes("failed to fetch")
  ) {
    return KNOWN_FAILURES.service_unavailable;
  }
  if (lower.includes("unsupported url") || lower.includes("not supported")) {
    return KNOWN_FAILURES.unsupported_source;
  }
  if (
    lower.includes("error.api.content_unavailable") ||
    lower.includes("error.api.private") ||
    lower.includes("error.api.not_found") ||
    lower.includes("media is private") ||
    lower.includes("private media") ||
    lower.includes("media unavailable") ||
    lower.includes("content unavailable") ||
    lower.includes("not found") ||
    /\b40[134]\b/.test(lower)
  ) {
    return KNOWN_FAILURES.private_or_missing;
  }
  if (
    lower.includes("malformed") ||
    lower.includes("invalid response") ||
    lower.includes("non-json") ||
    lower.includes("response was empty") ||
    lower.includes("missing audio") ||
    lower.includes("could not be parsed")
  ) {
    return KNOWN_FAILURES.invalid_response;
  }
  return null;
};

export const getSystemFailurePresentation = (
  error: unknown,
  context: SystemFailureContext,
): SystemFailurePresentation => {
  const known =
    context === "download" || context === "import"
      ? knownDownloadFailureFrom(errorMessage(error))
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
  error: unknown,
  context: SystemFailureContext,
): SystemFailurePresentation => {
  const presentation = getSystemFailurePresentation(error, context);

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
    return { title: storedPresentation.title, description: storedPresentation.trackDescription };
  }
  const storedFallback = Object.values(FALLBACKS).find(
    (presentation) => presentation.trackDescription === message,
  );
  if (storedFallback) {
    return { title: storedFallback.title, description: storedFallback.trackDescription };
  }

  const known = knownDownloadFailureFrom(message);
  if (known) return { title: known.title, description: known.trackDescription };

  return {
    title: "track error",
    description: "this track needs attention before it can be exported.",
  };
};

export const resetSystemFailureReportingForTest = () => {
  lastDownloadNotificationAt.clear();
};
