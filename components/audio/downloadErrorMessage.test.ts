import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getDownloadErrorMessage, notifyDownloadError } from "./downloadErrorMessage";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

beforeEach(() => {
  toastMocks.error.mockClear();
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
      id: "download-capacity-exceeded",
      description: "Too many downloads are running right now. Try again in a moment.",
    });
  });

  it("does not toast ordinary download failures", () => {
    notifyDownloadError(new Error("unsupported url"));

    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});
