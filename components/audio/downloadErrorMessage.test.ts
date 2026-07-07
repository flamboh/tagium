import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  getDownloadErrorMessage,
  notifyDownloadError,
  resetDownloadErrorNotificationsForTest,
} from "./downloadErrorMessage";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

beforeEach(() => {
  resetDownloadErrorNotificationsForTest();
  toastMocks.error.mockClear();
  vi.useRealTimers();
});

describe("download error messages", () => {
  it("maps Cobalt capacity errors to a friendly inline message", () => {
    const error = new Error(
      JSON.stringify({
        status: "error",
        error: { code: "error.api.capacity_exceeded" },
      }),
    );

    expect(getDownloadErrorMessage(error)).toBe("downloads are busy. try again in a moment.");
  });

  it("routes transient Cobalt errors to Sonner notifications", () => {
    notifyDownloadError(new Error("error.api.capacity_exceeded"));

    expect(toastMocks.error).toHaveBeenCalledWith("Downloads are busy", {
      id: "download-capacity",
      description: "Too many downloads are running right now. Try again in a moment.",
    });
  });

  it.each([
    ["Tagium rate limit", "Download rate limit exceeded."],
    ["Cobalt rate limit", "error.api.rate_exceeded"],
    ["Cobalt tunnel rate limit", "Cobalt tunnel request failed (429)."],
    ["generic HTTP 429", "Cobalt request failed with 429"],
  ])("maps %s errors to rate-limit copy", (_, message) => {
    const error = new Error(message);

    expect(getDownloadErrorMessage(error)).toBe(
      "download rate limit exceeded (429). try again shortly.",
    );

    notifyDownloadError(error);

    expect(toastMocks.error).toHaveBeenCalledWith("Download rate limit exceeded", {
      id: "download-rate-limit",
      description: "Some downloads were rate-limited. Waiting a moment before retrying may help.",
    });
  });

  it("debounces toast notifications by category", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    notifyDownloadError(new Error("error.api.rate_exceeded"));
    notifyDownloadError(new Error("Cobalt tunnel request failed (429)."));

    expect(toastMocks.error).toHaveBeenCalledTimes(1);

    vi.setSystemTime(15_001);
    notifyDownloadError(new Error("Cobalt tunnel request failed (429)."));

    expect(toastMocks.error).toHaveBeenCalledTimes(2);
  });

  it("does not debounce unrelated categories together", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    notifyDownloadError(new Error("error.api.rate_exceeded"));
    notifyDownloadError(new Error("error.api.capacity_exceeded"));

    expect(toastMocks.error).toHaveBeenCalledTimes(2);
  });

  it("does not toast ordinary download failures", () => {
    notifyDownloadError(new Error("unsupported url"));

    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});
