import { toast } from "sonner";

type DownloadErrorNotification = {
  id: string;
  title: string;
  description: string;
};

type DownloadErrorCategory = DownloadErrorNotification & {
  inlineMessage: string;
};

export type DownloadErrorDisplay = {
  title: string;
  description: string;
};

const TOAST_DEBOUNCE_MS = 15_000;

const lastNotifiedAtById = new Map<string, number>();

const DOWNLOAD_ERROR_CATEGORIES = {
  capacity: {
    id: "download-capacity",
    title: "Downloads are busy",
    description: "Too many downloads are running right now. Try again in a moment.",
    inlineMessage: "downloads are busy. try again in a moment.",
  },
  serviceUnavailable: {
    id: "download-service-unavailable",
    title: "Downloads unavailable",
    description: "Tagium could not reach the audio download service. Try again soon.",
    inlineMessage: "audio downloads are temporarily unavailable.",
  },
  timeout: {
    id: "download-timeout",
    title: "Download timed out",
    description: "The audio download service took too long to respond. Try again.",
    inlineMessage: "audio download timed out.",
  },
  rateLimit: {
    id: "download-rate-limit",
    title: "Download rate limit exceeded",
    description: "Some downloads were rate-limited. Waiting a moment before retrying may help.",
    inlineMessage: "download rate limit exceeded (429). try again shortly.",
  },
} as const satisfies Record<string, DownloadErrorCategory>;

const isRateLimitError = (message: string) =>
  message.includes("Download rate limit exceeded") ||
  message.includes("error.api.rate_exceeded") ||
  message.includes("Cobalt tunnel request failed (429)") ||
  message.includes("(429)") ||
  /\b429\b/.test(message);

const isTimeoutError = (message: string) =>
  message.includes("error.api.timed_out") || /\btimed?\s*out\b/i.test(message);

const getDownloadErrorCategory = (error: Error): DownloadErrorCategory | null => {
  const { message } = error;

  if (message.includes("error.api.capacity_exceeded")) {
    return DOWNLOAD_ERROR_CATEGORIES.capacity;
  }

  if (isRateLimitError(message)) {
    return DOWNLOAD_ERROR_CATEGORIES.rateLimit;
  }

  if (message.includes("error.api.unreachable")) {
    return DOWNLOAD_ERROR_CATEGORIES.serviceUnavailable;
  }

  if (isTimeoutError(message)) {
    return DOWNLOAD_ERROR_CATEGORIES.timeout;
  }

  return null;
};

export const getDownloadErrorDisplay = (errorMessage: string): DownloadErrorDisplay => {
  const category = getDownloadErrorCategory(new Error(errorMessage));
  if (category) {
    return {
      title: category.title,
      description: category.inlineMessage,
    };
  }

  return {
    title: "Download error",
    description: errorMessage,
  };
};

export const isCobaltCapacityError = (error: Error) =>
  error.message.includes("error.api.capacity_exceeded");

export const getDownloadErrorMessage = (error: Error) => {
  if (error.message.includes("COBALT_API_URL is not configured.")) {
    return "audio downloads are not configured on this server.";
  }

  const category = getDownloadErrorCategory(error);
  if (category) {
    return category.inlineMessage;
  }

  if (error.message.includes("error.tunnel.probe")) {
    return "audio download was not ready. try again.";
  }

  return error.message;
};

export const notifyDownloadError = (error: Error) => {
  const category = getDownloadErrorCategory(error);
  if (!category) return;

  const lastNotifiedAt = lastNotifiedAtById.get(category.id);
  const now = Date.now();
  if (lastNotifiedAt !== undefined && now - lastNotifiedAt < TOAST_DEBOUNCE_MS) {
    return;
  }

  lastNotifiedAtById.set(category.id, now);

  toast.error(category.title, {
    id: category.id,
    description: category.description,
  });
};

export const resetDownloadErrorNotificationsForTest = () => {
  lastNotifiedAtById.clear();
};
